/**
 * JwtStrategy —— auth/jwt.strategy.ts
 * 从 Bearer token 解 payload，查 DB 返回 {id,username,role}
 */
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '@/prisma/prisma.service'

export interface JwtPayload {
  sub: string
  username: string
  role: string
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'knowledge-agent-jwt-secret-change-me-in-production-32chars+'),
    })
  }

  /** passport 验证 token 后调用，返回值挂到 req.user */
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) throw new UnauthorizedException('token 已失效')
    const { passwordHash: _ph, ...safe } = user
    return safe
  }
}
