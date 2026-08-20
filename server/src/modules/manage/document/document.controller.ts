/**
 * DocumentController —— 文档管理接口
 * - GET    /api/v1/admin/documents          列表（分页/搜索/筛选）
 * - GET    /api/v1/admin/documents/:id      详情
 * - POST   /api/v1/admin/documents          上传（multipart）
 * - DELETE /api/v1/admin/documents/:id      软删
 * reindex/chunks/task-logs 接口
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { DocumentService } from './document.service'
import { BusinessException } from '@/common/filters/business.exception'
import { TaskLogService } from './task-log.service'
import { ChunkConfigAdvisor, type IndexConfig } from './strategy/chunk-config-advisor'
import { QueryDocumentDto } from './dto/query-document.dto'
import { UploadDocumentDto } from './dto/upload-document.dto'

@ApiTags('document')
@Controller('admin/documents')
export class DocumentController {
  constructor(
    private readonly doc: DocumentService,
    private readonly taskLog: TaskLogService,
    private readonly configAdvisor: ChunkConfigAdvisor,
  ) {}

  @Get()
  @ApiOperation({ summary: '文档列表（分页/搜索/筛选）' })
  list(@Query() q: QueryDocumentDto) {
    return this.doc.list(q)
  }

  @Get(':id')
  @ApiOperation({ summary: '文档详情' })
  detail(@Param('id') id: string) {
    return this.doc.detail(id)
  }

  @Post()
  @ApiOperation({ summary: '上传文档（multipart：file + 元信息）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: '文档文件（pdf/docx/txt/md）' },
        title: { type: 'string', description: '展示名（可选，默认取文件名）' },
        scopeId: { type: 'string' },
        topicId: { type: 'string' },
        businessType: { type: 'string', enum: ['HR', 'PRODUCT', 'OPS', 'FINANCE', 'OTHER'] },
        tags: { type: 'string', description: 'JSON 字符串，如 \'["退款","政策"]\'' },
      },
      required: ['file'],
    },
  })
  //  上传校验：FileInterceptor 配 limits（大小上限 50MB，对齐 nginx client_max_body_size）
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    // 文件非空检查（multer 未收到 file 字段时 file 为 undefined）
    if (!file) throw new BusinessException(1002, '文件不能为空')
    // multer 的 originalname 用 latin1 解码，中文会乱码，转回 utf8
    if (file.originalname) {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8')
    }
    return this.doc.upload(file, dto)
  }

  @Post(':id/reindex')
  @ApiOperation({ summary: '重新索引（Kafka 异步，INDEXING 中间态；可选 body 携带手动配置覆盖）' })
  reindex(@Param('id') id: string, @Body() body?: { config?: Partial<IndexConfig> }) {
    return this.doc.reindex(id, body?.config)
  }

  @Get(':id/task-logs')
  @ApiOperation({ summary: '文档处理任务记录（阶段时间线 + 进度）' })
  taskLogs(@Param('id') id: string) {
    return this.taskLog.list(id)
  }

  @Get(':id/overview')
  @ApiOperation({ summary: '文档概览（KPI 聚合：字符数/token数/分块数/总耗时等）' })
  overview(@Param('id') id: string) {
    return this.doc.overview(id)
  }

  @Get(':id/config/recommend')
  @ApiOperation({ summary: '系统推荐切块配置（含推荐理由）' })
  async configRecommend(@Param('id') id: string) {
    const doc = await this.doc.detail(id)
    return this.configAdvisor.getRecommendedWithReason(doc)
  }

  @Get(':id/config')
  @ApiOperation({ summary: '当前已存切块配置（null=从未手动覆盖，用推荐值）' })
  async config(@Param('id') id: string) {
    return this.configAdvisor.getSavedConfig(id)
  }

  @Put(':id/config')
  @ApiOperation({ summary: '保存手动覆盖切块配置（source→MANUAL）' })
  async saveConfig(@Param('id') id: string, @Body() body: Partial<IndexConfig>) {
    await this.configAdvisor.saveConfig(id, body)
    return this.configAdvisor.getSavedConfig(id)
  }

  @Get(':id/chunks')
  @ApiOperation({ summary: 'Chunk 预览（内容/章节路径/父块，跨库合并）' })
  chunks(@Param('id') id: string) {
    return this.doc.listChunks(id)
  }

  @Delete(':id')
  @ApiOperation({ summary: '软删文档' })
  remove(@Param('id') id: string) {
    return this.doc.softDelete(id)
  }
}
