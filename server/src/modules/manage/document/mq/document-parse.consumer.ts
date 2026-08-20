/**
 * DocumentParseConsumer —— 文档处理流水线（Kafka）
 * 同类注册两个实例：doc-parse 订阅 document-parse，doc-index 订阅 document-index，
 * 各配独立 groupId，每实例只订阅一个 topic，避免合并 group
 * 流水线：parse → 质检 → chunk → parent → vectorize → keyword → INDEXED，每阶段用 TaskLogService 打点
 * 失败语义：catch 置 FAILED + 写 taskLog 后重发带 retryCount 的消息（不 rethrow，commit 出队），超限标 FAILED 停投
 * 重投幂等：仅 status=INDEXED 且非手动覆盖时跳过，FAILED 允许重跑
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { DocumentStatus } from '@prisma/client'
import { PrismaService } from '@/prisma/prisma.service'
import { KafkaService } from '@/modules/infra/kafka.provider'
import { ParserService } from '../parser/parser.service'
import { VectorGatewayService } from '../vector-gateway/vector-gateway.service'
import { TaskLogService, STAGE } from '../task-log.service'
import { PARSE_STAGE, ERROR_CODE, truncateMsg, STAGE_TO_PARSE_STAGE, MAX_RETRY } from '../document-parse-stage'
import { QualityDetectorService } from '../quality-detector.service'
import { ParentBlockService } from '../parent-block.service'
import { KeywordIndexService } from '../keyword-index.service'
import { ChunkConfigAdvisor, type IndexConfig } from '../strategy/chunk-config-advisor'
import { StrategyExecutor } from '../strategy/strategy.executor'
import { ReindexLockService } from '../reindex-lock.service'
import { DocumentProducer } from './document-producer'
import { buildStructureNodes } from '../strategy/structure-node.builder'
import { DocumentProfileService } from '../strategy/document-profile.service'

@Injectable()
export class DocumentParseConsumer implements OnModuleInit {
  private readonly logger = new Logger(DocumentParseConsumer.name)

  constructor(
    private kafka: KafkaService,
    private prisma: PrismaService,
    private parser: ParserService,
    private vectorGateway: VectorGatewayService,
    private taskLog: TaskLogService,
    private qualityDetector: QualityDetectorService,
    private parentBlockService: ParentBlockService,
    private keywordIndex: KeywordIndexService,
    private configAdvisor: ChunkConfigAdvisor,
    private strategyExecutor: StrategyExecutor,
    private lockService: ReindexLockService,
    private documentProducer: DocumentProducer,
    private documentProfileService: DocumentProfileService,
    @Inject('KAFKA_TOPIC') private topic: string,
    @Inject('KAFKA_GROUP_ID') private groupId: string,
  ) {}

  onModuleInit() {
    // 注册失败/运行期断开的无限重试由 KafkaService.consume 内部负责（指数退避），无需在此 catch
    void this.kafka.consume(this.topic, this.groupId, (raw) => this.handle(raw))
  }

  /** 消息处理：幂等判断 + 阶段流水线 */
  private async handle(raw: string): Promise<void> {
    const { docId, config, retryCount = 0 } = JSON.parse(raw) as { docId: string; config?: unknown; retryCount?: number }
    // findUnique 而非 findUniqueOrThrow：文档不存在属永久性错误（重试也不会变），rethrow 会无限重投，改为安静跳过 + commit
    const doc = await this.prisma.document.findUnique({ where: { id: docId } })
    if (!doc) {
      this.logger.warn(`文档不存在 doc=${docId}，跳过消息（可能是删除后遗留的脏消息）`)
      return
    }

    // 幂等：仅 status=INDEXED 且非手动覆盖时跳过；FAILED 必须允许重跑（否则 FAILED 文档永不恢复）
    if (doc.status === DocumentStatus.INDEXED && !config) {
      // 已建索引且非手动覆盖 → 跳过；但锁可能残留（上次 reindex 的 10min TTL 未过期），顺手清掉
      await this.releaseReindexLock(docId)
      return
    }
    // 配置优先级：消息携带（reindex 手动覆盖）> DB 已存 DocumentIndexConfig > 推荐
    const cfg = await this.configAdvisor.loadOrRecommend(doc, config as Partial<IndexConfig> | undefined)

    // 非手动覆盖路径（首次上传/常规处理）：把推荐配置持久化为快照（source=RECOMMEND），已有配置不覆盖，
    // 前端可展示推荐方案，用户采纳或调整（调整即 saveConfig 覆盖）
    if (!config) {
      await this.configAdvisor.persistRecommendIfAbsent(doc, cfg)
    }

    // 先删后写：首次上传无旧数据；重投/重试清掉失败残留，
    // 避免 DocumentChunk 表累积重复行（pg 表靠 (document_id, chunk_index) upsert 覆盖）
    await this.prisma.documentChunk.deleteMany({ where: { documentId: docId } })
    await this.prisma.documentParentBlock.deleteMany({ where: { documentId: docId } })
    await this.vectorGateway.remove(docId)

    try {
      // currentStage 跟踪当前阶段，catch 时带出（errorMsg = [CHUNK] xxx）
      let currentStage: string = STAGE.PARSE
      // 辅助：更新 parseStage（展示字段，DB 抖动不应阻塞主流程 → 包 catch 吞）
      const setStage = async (stage: string): Promise<void> => {
        currentStage = stage
        const ps = STAGE_TO_PARSE_STAGE[stage]
        if (ps) {
          try { await this.prisma.document.update({ where: { id: docId }, data: { parseStage: ps } }) } catch { /* 展示字段，不阻塞 */ }
        }
      }
      try {
        // 1. 解析
        await setStage(STAGE.PARSE)
        const text = await this.taskLog.stage(docId, STAGE.PARSE, () => this.parser.parse(doc))
        this.logger.log(`解析完成 doc=${docId} chars=${text.length}`)

        // 2. 低质量检测：扫描件/加密 PDF 提取近空文本 → 直接 FAILED，不建脏索引
        const quality = await this.qualityDetector.detect(doc, text)
        if (quality === 'LOW') {
          await this.prisma.document.update({
            where: { id: docId },
            data: { status: DocumentStatus.FAILED, quality, errorCode: ERROR_CODE.LOW_QUALITY, errorMsg: truncateMsg('疑似扫描件/加密文档，未提取到有效文本') },
          })
          await this.taskLog.write(
            docId,
            STAGE.PARSE,
            'FAILED',
            '疑似扫描件/加密文档，未提取到有效文本。请上传文本版文档，或开启 OCR 预处理（可选）。',
          )
          return // 业务判定失败，不 rethrow（避免 Kafka 无限重投）
        }

        // 3. 组合切块：按 pipeline 顺序执行（生产型 → 转换型）
        await setStage(STAGE.CHUNK)
        const { chunks, headings } = await this.taskLog.stage(docId, STAGE.CHUNK, () => this.strategyExecutor.execute(text, cfg, quality))
        this.logger.log(`切块完成 doc=${docId} chunks=${chunks.length} pipeline=[${cfg.pipeline.join(' → ')}]`)

        // 3.5 结构节点落库（CHUNK 后、VECTORIZE 前）：从 headings 构建目录树，先删后插
        // catch 吞：结构节点非核心链路，DB 抖动不应触发整条重投（重解析重向量化代价大）
        await setStage(STAGE.STRUCTURE_NODE)
        await this.taskLog.stage(docId, STAGE.STRUCTURE_NODE, async () => {
          try {
            const nodes = buildStructureNodes(headings ?? [], text)
            if (nodes.length === 0) return // 无标题（RECURSIVE 兜底）跳过
            await this.prisma.documentStructureNode.deleteMany({ where: { documentId: docId } })
            await this.prisma.documentStructureNode.createMany({
              data: nodes.map((n) => ({ documentId: docId, nodeNo: n.nodeNo, parentId: n.parentId, level: n.level, title: n.title, content: n.content, canonicalPath: n.canonicalPath, lineNo: n.lineNo, confidence: n.confidence })),
            })
            this.logger.log(`结构节点落库 doc=${docId} nodes=${nodes.length}`)
          } catch (e) {
            this.logger.warn(`结构节点落库失败 doc=${docId}，跳过（不阻塞核心链路）：${e instanceof Error ? e.message : String(e)}`)
          }
        })

        // 4. 向量化 + 写库（必须先于 PARENT_BLOCK：build 的回填依赖 chunk 行已存在）
        await setStage(STAGE.VECTORIZE)
        await this.taskLog.stage(docId, STAGE.VECTORIZE, () => this.vectorGateway.write(docId, chunks))
        this.logger.log(`向量化完成 doc=${docId}`)

        // 5. Parent-Child 聚合：建 parent 记录 + 回填 DocumentChunk.parentBlockId + pg parent_id
        await setStage(STAGE.PARENT_BLOCK)
        await this.taskLog.stage(docId, STAGE.PARENT_BLOCK, async () => {
          await this.parentBlockService.build(docId, chunks)
          await this.parentBlockService.backfillPg(docId)
        })

        // 6. 关键词索引：应用层中文分词 → tsv_zh 列 + GIN 索引
        await setStage(STAGE.KEYWORD_INDEX)
        await this.taskLog.stage(docId, STAGE.KEYWORD_INDEX, () => this.keywordIndex.index(docId, chunks))

        // 6.5 文档画像（KEYWORD_INDEX 后、INDEXED 前）：LLM 生成类型/主题/示例问题，
        // 包 taskLog.stage 打点；generate 内部 catch 静默跳过（画像非必需，不阻塞 INDEXED）
        await setStage(STAGE.PROFILE)
        await this.taskLog.stage(docId, STAGE.PROFILE, async () => {
          const structureNodes = await this.prisma.documentStructureNode.findMany({ where: { documentId: docId }, orderBy: { nodeNo: 'asc' } })
          await this.documentProfileService.generate(docId, structureNodes.map((n) => ({ nodeNo: n.nodeNo, parentId: n.parentId, level: n.level, title: n.title, content: n.content, canonicalPath: n.canonicalPath, lineNo: n.lineNo ?? 0, confidence: n.confidence ?? 1 })), text)
        })

        // 7. 更新状态 + 统计（tokenCount 粗估：混合中英文约 4 字符/token）
        const tokenCount = Math.ceil(text.length / 4)
        await this.prisma.document.update({
          where: { id: docId },
          data: { status: DocumentStatus.INDEXED, parseStage: PARSE_STAGE.INDEXED, charCount: text.length, tokenCount, quality, errorCode: null, errorMsg: null },
        })
        this.logger.log(`文档处理完成 doc=${docId} status=INDEXED`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.error(`文档处理失败 doc=${docId} [${currentStage}] retry=${retryCount}: ${msg}`)

        // 失败重投限流：retryCount < MAX_RETRY 时重发带 +1 的消息并 commit 出队（不 rethrow，
        // 避免 kafkajs retries 无限重投挤占队列），超限标 FAILED 停投
        // 与补偿扫描的交互：重发消息滞留 >10min 时，补偿扫描会以 retryCount=0 重发，计数被重置，
        // 可接受（15min 超龄 FAILED 兜底 + retry=3 单链兜底 + 业务失败秒级重试拖不到 10 分钟）；
        // 上限语义：单条消息链最多 3 次重试 + 每滞留 10 分钟可能 +3，非全局绝对 3 次
        if (retryCount < MAX_RETRY) {
          this.logger.warn(`[retry] doc=${docId} 重发消息 retry=${retryCount + 1}/${MAX_RETRY}`)
          // 发新消息后不 rethrow → kafka 视为处理成功 → commit 出队（旧消息不再重投）
          // 标记 PARSING（展示态）+ 写 taskLog，不标 FAILED（还有重试机会）
          await this.prisma.document.update({
            where: { id: docId },
            data: { status: DocumentStatus.PARSING, errorCode: ERROR_CODE.PIPELINE_ERROR, errorMsg: truncateMsg(`[${currentStage}] ${msg}（重试 ${retryCount + 1}/${MAX_RETRY}）`) },
          }).catch(() => {})
          await this.taskLog.write(docId, STAGE.FAILED_STAGE, 'FAILED', `[retry ${retryCount + 1}/${MAX_RETRY}] ${msg}`)
          // 重发：按 topic 选 sendParse/sendIndex（document-parse vs document-index）
          if (this.topic === 'document-parse') {
            await this.documentProducer.sendParse(docId, retryCount + 1).catch(() => {})
          } else {
            await this.documentProducer.sendIndex(docId, config as Partial<IndexConfig> | undefined, retryCount + 1).catch(() => {})
          }
          return // 不 rethrow，让 kafka commit
        }

        // 超限：标 FAILED + 不 rethrow（停止重投，坏消息出队）
        await this.prisma.document.update({
          where: { id: docId },
          data: { status: DocumentStatus.FAILED, errorCode: ERROR_CODE.MAX_RETRY_EXCEEDED, errorMsg: truncateMsg(`[${currentStage}] ${msg}（重试已达上限 ${MAX_RETRY} 次）`) },
        })
        await this.taskLog.write(docId, STAGE.FAILED_STAGE, 'FAILED', `重试已达上限（${MAX_RETRY}次），停止重投：${msg}`)
        this.logger.error(`[retry-exhausted] doc=${docId} 重试 ${retryCount} 次仍失败，标 FAILED 停投`)
        // 不 rethrow → kafka commit 出队（坏消息不再重投）
      }
    } finally {
      // 无论成功/失败/短路，都释放 reindex 租约锁（避免重建完仍锁 10 分钟无法再次 reindex）
      // 对 document-parse（首次上传）此 key 不存在，del 安全返回 0
      await this.releaseReindexLock(docId)
    }
  }

  /**
   * 释放 reindex 租约锁（幂等：无锁/已释放均安全）
   * 走 forceRelease（无条件 del）：consumer 是锁的合法处理方；且为兼容多实例部署
   * （reindex 在 A 进程加锁、消费在 B 进程时拿不到 owner），统一不做 owner 比对
   * try/catch 兜底：service 内部已吞 Redis 错误，这里防御性兜住，释放失败不阻塞主流程（锁有 TTL 兜底）
   */
  private async releaseReindexLock(docId: string): Promise<void> {
    try {
      await this.lockService.forceRelease(docId)
    } catch {
      // 释放失败不阻塞主流程
    }
  }
}
