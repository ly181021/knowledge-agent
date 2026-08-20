/**
 * AuthController —— 鉴权接口
 * - POST /api/v1/auth/login   登录，返回 JWT
 * - GET  /api/v1/auth/profile 当前用户信息
 */
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '@/common/decorators/public.decorator'
import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: '管理员登录，返回 JWT' })
  async login(@Body() dto: LoginDto) {
    const user = await this.auth.validateUser(dto.username, dto.password)
    return this.auth.login(user)
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiOperation({ summary: '当前用户信息' })
  profile(@CurrentUser() user: CurrentUserPayload) {
    return user
  }
}
