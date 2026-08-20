/**
 * AuthService —— auth/auth.service.ts
 * 职责：验证用户名密码 + 签发 JWT
 */
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '@/prisma/prisma.service'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  /** 验证用户名密码，返回用户（不含 passwordHash） */
  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } })
    if (!user) throw new UnauthorizedException('用户不存在或密码错误')

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) throw new UnauthorizedException('用户不存在或密码错误')

    // 不返回 passwordHash
    const { passwordHash: _ph, ...safe } = user
    return safe
  }

  /** 签 JWT，payload 含 id/username/role */
  async login(user: { id: string; username: string; role: string }) {
    const payload = { sub: user.id, username: user.username, role: user.role }
    const token = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '720m'),
    })
    return {
      token,
      user: { id: user.id, username: user.username, role: user.role },
    }
  }
}
