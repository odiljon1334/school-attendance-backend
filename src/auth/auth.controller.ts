import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt.auth.guards';
import { LoginDto, RegisterDto, ChangePasswordDto, ResetPasswordDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@Request() req: any) {
    return this.authService.validateUser(req.user.sub);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Request() req: any) {
    return this.authService.validateUser(req.user.sub);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Request() req: any,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.sub,
      dto.oldPassword,
      dto.newPassword,
    );
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  refreshToken(@Request() req: any) {
    return this.authService.refreshToken(req.user.sub);
  }
}