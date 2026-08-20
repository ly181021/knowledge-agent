/**
 * 业务异常 —— 对应BusinessException
 * 携带 code，供 HttpExceptionFilter 转成统一响应
 */
import { HttpException, HttpStatus } from '@nestjs/common'

export class BusinessException extends HttpException {
  constructor(
    public readonly bizCode: number,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code: bizCode, message }, status)
  }
}
