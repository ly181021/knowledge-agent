/**
 * 全局异常过滤器 —— common/filters
 */
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { MulterError } from 'multer'
import { Request, Response } from 'express'
import { ApiResponse } from '@/common/response/api-response'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let bizCode = 500
    let message = '服务器内部错误'

    // multer 文件大小超限：MulterError 不是 HttpException，需单独拦截，否则落到 500 英文原文
    if (exception instanceof MulterError) {
      status = HttpStatus.PAYLOAD_TOO_LARGE // 413
      bizCode = 413
      message = exception.code === 'LIMIT_FILE_SIZE' ? '文件大小超过 50MB 限制' : exception.message
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      const resp = exception.getResponse()
      if (typeof resp === 'object' && resp !== null) {
        // BusinessException 形态：{ code, message }
        const r = resp as { code?: number; message?: string }
        bizCode = r.code ?? status
        message = r.message ?? exception.message
      } else if (typeof resp === 'string') {
        message = resp
        bizCode = status
      }
    } else if (exception instanceof Error) {
      message = exception.message
    }

    this.logger.error(`[${req.method}] ${req.url} -> ${status} ${message}`, exception instanceof Error ? exception.stack : '')

    res.status(status).json(ApiResponse.error(bizCode, message))
  }
}
