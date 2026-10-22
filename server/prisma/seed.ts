/**
 * Prisma Seed —— 建首个 admin 用户
 *
 * 用法：pnpm prisma db seed
 * 读 .env 的 SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin'
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!password) throw new Error('SEED_ADMIN_PASSWORD 未配置，请在 server/.env 设置管理员密码')
  const passwordHash = bcrypt.hashSync(password, 10)

  const user = await prisma.user.upsert({
    where: { username },
    update: {}, // 已存在不覆盖密码，改密码改 .env 后手动删行再 seed
    create: { username, passwordHash, role: 'ADMIN' },
  })

  // eslint-disable-next-line no-console
  console.log(`✅ seeded admin: ${user.username} (id: ${user.id})`)
  // eslint-disable-next-line no-console
  console.log(`   账号: ${username} / 密码: ${password}`)
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('seed 失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
