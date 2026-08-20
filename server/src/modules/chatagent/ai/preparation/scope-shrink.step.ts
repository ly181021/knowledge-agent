/**
 * ScopeShrinkStep —— 五步责任链第 3 步：知识域收缩
 * 当前无 Scope/Topic 数据（KnowledgeScope/KnowledgeTopic 表为空），保留接口空操作
 */
import { Injectable, Logger } from '@nestjs/common'
import type { PlanContext } from './plan-context'
import { NoopProgressEmitter, type ProgressEmitter } from '../progress-emitter'

@Injectable()
export class ScopeShrinkStep {
  private readonly logger = new Logger(ScopeShrinkStep.name)

  async execute(
    _ctx: PlanContext,
    emitter: ProgressEmitter = new NoopProgressEmitter(),
  ): Promise<void> {
    // 当前无知识域数据，直接跳过
    this.logger.debug('scopeShrink: skipped (no scope/topic data)')
    this.emitSafe(emitter, 'scopeShrink', { skipped: true })
  }

  /** emit 包装：任何异常都不应中断主链路 */
  private emitSafe(emitter: ProgressEmitter, step: 'scopeShrink', payload: Record<string, unknown>): void {
    try {
      emitter.emit({ step, ts: Date.now(), payload })
    } catch (e) {
      this.logger.warn(`progress emit failed step=${step}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
