/**
 * 统一响应拦截器 —— common/interceptors
 * 把 controller 返回值包装成 { code, message, data }
 * 注意：SSE 流式接口（ChatController）用 @Res 拿 Express response 直接写流，
 * controller 不返回值（void），该拦截器收到 undefined 时仍包装成 ok(null)，
 * 但 @Res 已接管响应，NestJS 不会再发送拦截器返回值，所以不影响 SSE。
 * 此拦截器仅作用于返回值的 controller（GET/POST 普通 JSON 接口）。
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { map, Observable } from 'rxjs'
import { ApiResponse } from '@/common/response/api-response'

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | unknown> {
  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | unknown> {
    return next.handle().pipe(
      map((data: T | undefined) => {
        // controller 用 @Res 直接接管响应（如 SSE），返回 undefined，不包装
        if (data === undefined) return data
        // Vercel AI SDK Response 对象不包装（由 AI SDK 直接写流）
        if (data && typeof data === 'object' && 'body' in data && 'status' in data && typeof (data as { status: unknown }).status === 'number') {
          return data
        }
        // 已是 ApiResponse 就直接返回
        if (data instanceof ApiResponse) return data
        return ApiResponse.ok(data as T)
      }),
    )
  }
}
