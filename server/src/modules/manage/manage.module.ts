/**
 * ManageModule —— 文档管理模块
 * observability 子模块 + Kafka 文档流水线（DocumentProducer + DocumentParseConsumer 双实例）
 * + ReindexLockService（reindex 双层并发锁，单例跨 consumer 实例共享进程内 Map）
 */
import { Module } from '@nestjs/common'
import { InfraModule } from '@/modules/infra/infra.module'
import { KafkaService } from '@/modules/infra/kafka.provider'
import { PrismaModule } from '@/prisma/prisma.module'
import { PrismaService } from '@/prisma/prisma.service'
import { DocumentController } from './document/document.controller'
import { DocumentService } from './document/document.service'
import { ReindexLockService } from './document/reindex-lock.service'
import { ParserService } from './document/parser/parser.service'
import { ChunkService } from './document/strategy/chunk.service'
import { StructureChunkService } from './document/strategy/structure-chunk.service'
import { HeadingDisambiguator } from './document/strategy/heading-disambiguator'
import { VectorGatewayService } from './document/vector-gateway/vector-gateway.service'
import { DocumentProducer } from './document/mq/document-producer'
import { DocumentParseConsumer } from './document/mq/document-parse.consumer'
import { TaskLogService } from './document/task-log.service'
import { QualityDetectorService } from './document/quality-detector.service'
import { ParentBlockService } from './document/parent-block.service'
import { KeywordIndexService } from './document/keyword-index.service'
import { ChunkConfigAdvisor } from './document/strategy/chunk-config-advisor'
import { SemanticChunker } from './document/strategy/semantic-chunker'
import { LlmSplitter } from './document/strategy/llm-splitter'
import { StrategyExecutor } from './document/strategy/strategy.executor'
import { DocumentProfileService } from './document/strategy/document-profile.service'
import { StaleDocScannerService } from './document/stale-doc-scanner.service'
import { ObservabilityController } from './observability/observability.controller'
import { ObservabilityService } from './observability/observability.service'
import { MetricsService } from './observability/metrics.service'

@Module({
  imports: [InfraModule, PrismaModule],
  controllers: [DocumentController, ObservabilityController],
  providers: [
    DocumentService,
    ReindexLockService,
    ParserService,
    ChunkService,
    // ：标题 LLM 判歧（StructureChunkService 依赖它，必须先注册）
    HeadingDisambiguator,
    StructureChunkService,
    VectorGatewayService,
    DocumentProducer,
    TaskLogService,
    QualityDetectorService,
    ParentBlockService,
    KeywordIndexService,
    ChunkConfigAdvisor,
    SemanticChunker,
    LlmSplitter,
    StrategyExecutor,
    // DocumentParseConsumer 双实例：每实例只订阅一个 topic、各配独立 groupId（避免合并 group）
    // 双实例共享同一 ReindexLockService 单例 → 进程内 Map 跨实例生效（双层锁）
    {
      provide: 'DOC_PARSE_CONSUMER',
      useFactory: (kafka: KafkaService, prisma: PrismaService, parser: ParserService, vg: VectorGatewayService, taskLog: TaskLogService, quality: QualityDetectorService, parentBlock: ParentBlockService, keywordIndex: KeywordIndexService, configAdvisor: ChunkConfigAdvisor, strategyExecutor: StrategyExecutor, lockService: ReindexLockService, docProducer: DocumentProducer, profileService: DocumentProfileService) =>
        new DocumentParseConsumer(kafka, prisma, parser, vg, taskLog, quality, parentBlock, keywordIndex, configAdvisor, strategyExecutor, lockService, docProducer, profileService, 'document-parse', kafka.groupId('document-parse')),
      inject: [KafkaService, PrismaService, ParserService, VectorGatewayService, TaskLogService, QualityDetectorService, ParentBlockService, KeywordIndexService, ChunkConfigAdvisor, StrategyExecutor, ReindexLockService, DocumentProducer, DocumentProfileService],
    },
    {
      provide: 'DOC_INDEX_CONSUMER',
      useFactory: (kafka: KafkaService, prisma: PrismaService, parser: ParserService, vg: VectorGatewayService, taskLog: TaskLogService, quality: QualityDetectorService, parentBlock: ParentBlockService, keywordIndex: KeywordIndexService, configAdvisor: ChunkConfigAdvisor, strategyExecutor: StrategyExecutor, lockService: ReindexLockService, docProducer: DocumentProducer, profileService: DocumentProfileService) =>
        new DocumentParseConsumer(kafka, prisma, parser, vg, taskLog, quality, parentBlock, keywordIndex, configAdvisor, strategyExecutor, lockService, docProducer, profileService, 'document-index', kafka.groupId('document-index')),
      inject: [KafkaService, PrismaService, ParserService, VectorGatewayService, TaskLogService, QualityDetectorService, ParentBlockService, KeywordIndexService, ChunkConfigAdvisor, StrategyExecutor, ReindexLockService, DocumentProducer, DocumentProfileService],
    },
    ObservabilityService,
    MetricsService,
    // 滞留文档补偿扫描（@Interval 定时扫 status=PARSING 超时文档，重投/标 FAILED）
    StaleDocScannerService,
    //  文档画像 LLM 生成（consumer 依赖）
    DocumentProfileService,
  ],
})
export class ManageModule {}
