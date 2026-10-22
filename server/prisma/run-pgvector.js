/**
 * run-pgvector.js —— 容器化 PG 初始化脚本
 *
 * 用 pg.Client 连 PostgreSQL 执行 pgvector.sql，幂等建 document_chunks_vec 表 + 索引。
 * 复用项目既定的 PG 连接模式（见 vector.channel.ts 的 new Client({ connectionString })）。
 *
 * 为何不用 psql -f：server 镜像已含 pg 库（dependencies），无需额外装 psql 客户端。
 *
 * 幂等说明：
 *   pgvector.sql 里 CREATE EXTENSION / CREATE TABLE / CREATE INDEX 都是 IF NOT EXISTS（天然幂等）。
 *   但 ALTER TABLE ADD CONSTRAINT 没有 IF NOT EXISTS 语法 —— 这里用 try/catch 包住单条语句，
 *   捕获 constraint already exists 错误视为成功（首次建表生效，重复执行跳过）。
 *
 * 用法：node prisma/run-pgvector.js   （读 PG_URL 环境变量）
 */
/* eslint-disable no-console, @typescript-eslint/no-require-imports -- node 直接执行的 CJS 初始化脚本：require 是其执行方式，console 是其唯一输出通道 */
const { readFileSync } = require('fs')
const { join } = require('path')
const { Client } = require('pg')

const PG_URL = process.env.PG_URL
if (!PG_URL) throw new Error('PG_URL 未配置，请在 server/.env 填入 pgvector 连接串')

async function main() {
  const sqlPath = join(__dirname, 'pgvector.sql')
  const sql = readFileSync(sqlPath, 'utf8')

  // pg.query 默认把整段 SQL 当一条语句；pgvector.sql 含多条语句，需拆分按条执行，
  // 这样单条 ALTER TABLE 失败可单独 catch 不影响其他语句。
  // 先按行剔除 -- 注释（SQL 里无块注释 /* */），再按 ; 分号拆分语句。
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  const client = new Client({ connectionString: PG_URL })
  await client.connect()
  try {
    for (const stmt of statements) {
      try {
        await client.query(stmt)
      } catch (err) {
        // ALTER TABLE ADD CONSTRAINT 重复执行会报 already exists，属正常幂等情况
        const msg = err instanceof Error ? err.message : String(err)
        if (/already exists/i.test(msg)) {
          console.log(`[skip] ${msg}（幂等跳过）`)
          continue
        }
        throw err
      }
    }
    console.log('✅ pgvector schema initialized (document_chunks_vec + indexes)')
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('❌ pgvector init failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
