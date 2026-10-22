/**
 * env.schema 启动强校验用例 —— config/
 * 占位符样本用合成串构造：拦截特征是双花括号开头与 change-me 片段，不把仓库历史里的旧默认密钥串写进新文件
 */
import { randomBytes } from 'crypto'
import { validateEnv } from './env.schema'

const validSecret = randomBytes(48).toString('base64')
const placeholderLike = ['{{', 'SECRET_sample', '}}'].join('')
// 与历史泄露密钥同形态：长度足 32、不含双花括号、含 change-me 片段，旧规则会放行
const leakedLike = 'some-old-default-secret-change-me-in-production-padding!'
// 除被测字段外其余必填项的合法基线，用例按需覆盖被测字段
const baseEnv = {
  JWT_SECRET: validSecret,
  PG_URL: 'postgresql://demo:demo@localhost:5432/demo',
  MINIO_ACCESS_KEY: 'demo-ak',
  MINIO_SECRET_KEY: 'demo-sk',
}

describe('env.schema 启动强校验', () => {
  it('缺失 JWT_SECRET 拒绝并指明字段', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/)
  })

  it('示例文件占位符形态拒绝', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_SECRET: placeholderLike })).toThrow(/占位符/)
  })

  it('历史泄露密钥同形态拒绝（长度足但含 change-me 片段）', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_SECRET: leakedLike })).toThrow(/占位符/)
  })

  it('change-me 大小写变体同样拒绝', () => {
    expect(() =>
      validateEnv({ ...baseEnv, JWT_SECRET: leakedLike.replace('change-me', 'CHANGE-ME') }),
    ).toThrow(/占位符/)
  })

  it('短于 32 字符拒绝', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_SECRET: 'x'.repeat(16) })).toThrow(/32/)
  })

  it('缺失 PG_URL 拒绝并指明字段', () => {
    expect(() => validateEnv({ ...baseEnv, PG_URL: undefined })).toThrow(/PG_URL/)
  })

  it('PG_URL 非 postgresql 前缀拒绝', () => {
    expect(() => validateEnv({ ...baseEnv, PG_URL: 'mysql://demo@localhost:3306/demo' })).toThrow(
      /postgresql/,
    )
  })

  it('缺失 MinIO 凭据拒绝', () => {
    expect(() => validateEnv({ ...baseEnv, MINIO_ACCESS_KEY: undefined })).toThrow(/MINIO_ACCESS_KEY/)
    expect(() => validateEnv({ ...baseEnv, MINIO_SECRET_KEY: undefined })).toThrow(/MINIO_SECRET_KEY/)
  })

  it('合法配置通过且未配置项取默认值', () => {
    const env = validateEnv(baseEnv)
    expect(env.JWT_SECRET).toBe(validSecret)
    expect(env.JWT_EXPIRES_IN).toBe('720m')
  })

  it('未登记进 schema 的变量原样透传', () => {
    const env = validateEnv({ ...baseEnv, DATABASE_URL: 'mysql://demo' })
    expect(env.DATABASE_URL).toBe('mysql://demo')
  })
})
