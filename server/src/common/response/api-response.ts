/**
 * 统一响应封装
 */
export class ApiResponse<T> {
  constructor(
    public readonly code: number,
    public readonly message: string,
    public readonly data: T,
  ) {}

  static ok<T>(data: T, message = 'ok'): ApiResponse<T> {
    return new ApiResponse(0, message, data)
  }

  static error(code: number, message: string): ApiResponse<null> {
    return new ApiResponse(code, message, null)
  }
}

export type R<T> = ApiResponse<T>
