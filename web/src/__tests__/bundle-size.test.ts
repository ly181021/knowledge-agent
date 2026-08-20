import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

function gzipSize(filePath: string): number {
  const buf = fs.readFileSync(filePath)
  return zlib.gzipSync(buf).length
}

function listJsChunks(dir: string): { name: string; gzipKb: number }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ name: f, gzipKb: Math.round(gzipSize(path.join(dir, f)) / 1024) }))
    .sort((a, b) => b.gzipKb - a.gzipKb)
}

describe('bundle size thresholds', () => {
  const distAssetsDir = path.resolve(__dirname, '../../dist/assets')

  it('dist/assets 存在（需先 pnpm build）', () => {
    expect(fs.existsSync(distAssetsDir)).toBe(true)
  })

  // 基线 2026-08-06：总 486 KB（echarts vendor 172 KB 是大头），留 14KB 余量
  it('总 gzip JS < 500 KB', () => {
    const chunks = listJsChunks(distAssetsDir)
    const total = chunks.reduce((s, c) => s + c.gzipKb, 0)
    expect(total).toBeLessThan(500)
  })

  it('单 chunk gzip < 180 KB', () => {
    const chunks = listJsChunks(distAssetsDir)
    const max = chunks.length > 0 ? Math.max(...chunks.map((c) => c.gzipKb)) : 0
    expect(max).toBeLessThan(180)
  })
})
