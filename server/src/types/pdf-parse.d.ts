/**
 * pdf-parse 模块声明（无 @types/pdf-parse）
 */
declare module 'pdf-parse' {
  interface PdfResult {
    text: string
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    textHash: string
  }
  function pdf(buffer: Buffer | string): Promise<PdfResult>
  export default pdf
}
