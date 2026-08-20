/**
 * LocalStrategy —— auth/local.strategy.ts
 * 用于登录接口校验 username/password，调 AuthService.validateUser
 * 登录实际走 AuthService.validateUser 即可，不强制走 Passport local 策略，
 * 但保留此文件，如需可用 @UseGuards(AuthGuard('local'))
 */
import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-local'
import { AuthService } from './auth.service'

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private auth: AuthService) {
    super({ usernameField: 'username', passwordField: 'password' })
  }

  async validate(username: string, password: string) {
    return this.auth.validateUser(username, password)
  }
}
