/**
 * ObservabilityController —— 可观测接口
 * 5 个端点，全在 /admin/observability 下
 */
import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { MetricsService } from './metrics.service'
import { ObservabilityService } from './observability.service'

@ApiTags('observability')
@Controller('admin/observability')
export class ObservabilityController {
  constructor(
    private metricsService: MetricsService,
    private observabilityService: ObservabilityService,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: '看板聚合指标' })
  async metrics(@Query('range') range?: string) {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 9999 // all / 其他 → 全部
    const [tokenTrend, topHitDocuments, modeDistribution] = await Promise.all([
      this.metricsService.tokenTrend(days),
      this.metricsService.topHitDocuments(),
      this.metricsService.modeDistribution(),
    ])
    return { tokenTrend, topHitDocuments, modeDistribution }
  }

  @Get('sessions')
  @ApiOperation({ summary: '会话列表（支持筛选）' })
  sessions(
    @Query('page') page = '1',
    @Query('size') size = '20',
    @Query('keyword') keyword?: string,
    @Query('mode') mode?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.observabilityService.listSessions({
      page: Number(page), size: Number(size), keyword, mode, dateFrom, dateTo,
    })
  }

  @Get('documents/:docId/sessions')
  @ApiOperation({ summary: '命中该文档的会话列表（钻取）' })
  documentSessions(@Param('docId') docId: string) {
    return this.observabilityService.documentSessions(docId)
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: '会话详情' })
  sessionDetail(@Param('id') id: string) {
    return this.observabilityService.sessionDetail(id)
  }

  @Get('sessions/:id/trace')
  @ApiOperation({ summary: 'trace 时间线' })
  sessionTrace(@Param('id') id: string) {
    return this.metricsService.sessionTrace(id)
  }

  @Get('sessions/:id/retrieval')
  @ApiOperation({ summary: '检索结果回溯' })
  sessionRetrieval(@Param('id') id: string) {
    return this.observabilityService.sessionRetrieval(id)
  }
}
