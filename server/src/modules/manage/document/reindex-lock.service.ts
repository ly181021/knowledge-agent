/**
 * ReindexLockService —— reindex 双层并发锁
 * 1. 进程内 Map 短路：条目带 acquiredAt，2×TTL 失效可覆盖（Redis 会过期，Map 不能更长命，防消息丢失永久锁死）
 * 2. Redis SET NX EX（value=owner）：跨进程互斥，TTL 兜底崩溃释放
 * 3. owner + Lua 比对释放：多实例下 A 的锁过期、B 拿到新锁后，A 的回滚不会删掉 B 的锁
 * release 供 DocumentService 失败回滚（owner 比对）；forceRelease 供 consumer 无条件释放（consumer 是锁的合法处理方）
 * Redis 不可用时 acquire 照常失败，不降级为纯 Map 锁
 */
import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { RedisService } from '@/modules/infra/redis.provider'
import { BusinessException } from '@/common/filters/business.exception'

interface LockEntry {
  owner: string
  acquiredAt: number
}

@Injectable()
export class ReindexLockService {
  private readonly logger = new Logger(ReindexLockService.name)
  private readonly ttl = 600
  /** 进程层条目失效阈值（2×TTL）：Redis 锁 600s 必过期，Map 条目过期后允许重新加锁 */
  private readonly staleMs = this.ttl * 2 * 1000
  /** 进程层：Map 在单例 service 里，两个 consumer 实例注入的是同一个 → 跨实例共享 */
  private readonly holders = new Map<string, LockEntry>()

  constructor(private redis: RedisService) {}

  private key(docId: string): string {
    return `reindex:doc:${docId}`
  }

  /** 加锁：进程层短路 → Redis NX（value=owner）。返回 owner；失败抛 BusinessException(1001) */
  async acquire(docId: string): Promise<string> {
    // 第一层：进程内（条目超时视为失效，允许重新加锁，见类注释）
    const entry = this.holders.get(docId)
    if (entry && Date.now() - entry.acquiredAt < this.staleMs) {
      throw new BusinessException(1001, '文档正在重建中，请稍后再试')
    }
    // 第二层：Redis（NX 原子，value 带 owner 让释放可校验）
    const owner = randomUUID()
    const acquired = await this.redis.getClient().set(this.key(docId), owner, 'EX', this.ttl, 'NX')
    if (!acquired) throw new BusinessException(1001, '文档正在重建中，请稍后再试')
    this.holders.set(docId, { owner, acquiredAt: Date.now() })
    return owner
  }

  /** 释放（owner 比对）：DocumentService 失败回滚用。幂等（key 已过期/被覆盖时返回 0 不删） */
  async release(docId: string, owner: string): Promise<void> {
    this.holders.delete(docId) // 进程层先清
    try {
      // Lua 保证 读 value 比对 + del 原子，避免 TOCTOU：A 判 owner 相等准备删时，B 同刻拿到新锁被误删
      const script = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`
      await this.redis.getClient().eval(script, 1, this.key(docId), owner)
    } catch {
      // Redis 不可用不阻塞（进程层已清 + TTL 兜底）
    }
  }

  /** 释放（无条件）：consumer 用。consumer 是锁的合法处理方，无条件 del 安全（幂等：key 不存在返回 0） */
  async forceRelease(docId: string): Promise<void> {
    this.holders.delete(docId)
    try {
      await this.redis.getClient().del(this.key(docId))
    } catch {
      // Redis 不可用不阻塞（进程层已清 + TTL 兜底）
    }
  }
}
