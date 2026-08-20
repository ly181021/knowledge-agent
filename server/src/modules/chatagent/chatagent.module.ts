/**
 * ChatagentModule —— 对话模块：controller + service + preparation + rag + memory + trace + Kafka
 */
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InfraModule } from '@/modules/infra/infra.module'
import { PrismaModule } from '@/prisma/prisma.module'
import { PrismaService } from '@/prisma/prisma.service'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { PreparationOrchestrator } from './ai/preparation/orchestrator'
import { RewriteStep } from './ai/preparation/rewrite.step'
import { SubQuestionStep } from './ai/preparation/sub-question.step'
import { ScopeShrinkStep } from './ai/preparation/scope-shrink.step'
import { ExecutorRegistry, ClarificationExecutor, RetrievalExecutor, ReactAgentExecutor } from './ai/executor/registry'
import { ReactAgentService } from './ai/react-agent/react-agent.service'
import { RagService } from './rag/rag.service'
import { VectorChannel } from './rag/channel/vector.channel'
import { KeywordChannel } from './rag/channel/keyword.channel'
import { NoneMemory } from './memory/none.memory'
import { SlidingWindowMemory } from './memory/sliding-window.memory'
import { SummaryMemory } from './memory/summary.memory'
import { SummaryProducer } from './memory/summary-producer'
import { SummaryMergeConsumer } from './memory/summary-merge.consumer'
import { TraceRecorder } from './service/trace/trace-recorder'
import { RecommendationService } from './service/recommendation.service'

@Module({
  imports: [
    InfraModule,
    PrismaModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    // 五步责任链
    RewriteStep,
    SubQuestionStep,
    ScopeShrinkStep,
    PreparationOrchestrator,
    // 执行器
    ClarificationExecutor,
    RetrievalExecutor,
    ReactAgentExecutor,
    ExecutorRegistry,
    // ReAct 自托管流（tools + maxSteps + 熔断）
    ReactAgentService,
    // RAG
    RagService,
    VectorChannel,
    KeywordChannel,
    // 记忆：按 MEMORY_STRATEGY 配置选策略（none/sliding/summary，默认 summary），
    // 三条链路（chat.service/retrieval/react-agent）统一注入 CHAT_MEMORY，不再各自硬编码
    {
      provide: 'CHAT_MEMORY',
      useFactory: (config: ConfigService, prisma: PrismaService, producer: SummaryProducer) => {
        const strategy = config.get<string>('MEMORY_STRATEGY', 'summary')
        return {
          none: new NoneMemory(prisma),
          sliding: new SlidingWindowMemory(prisma),
          summary: new SummaryMemory(prisma, producer),
        }[strategy]
      },
      inject: [ConfigService, PrismaService, SummaryProducer],
    },
    SummaryProducer,
    SummaryMergeConsumer,
    // Trace
    TraceRecorder,
    // 推荐追问生成（项 ）
    RecommendationService,
  ],
})
export class ChatagentModule {}
