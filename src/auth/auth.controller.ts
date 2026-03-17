import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Get,
  Ip,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, ChangePasswordDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt.auth.guards';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ==========================================
  // ✅ USER ENDPOINTS
  // ==========================================

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  // 5 urinish / 60 soniya — brute-force himoya
  @Post('login')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Ip() ip: string) {
    return this.authService.login(loginDto, ip);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req) {
    return this.authService.validateUser(req.user.sub);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(@Request() req) {
    return this.authService.refreshToken(req.user.sub);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.sub,
      changePasswordDto.oldPassword,
      changePasswordDto.newPassword,
    );
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body('email') email: string) {
    return this.authService.resetPassword(email);
  }

  // ==========================================
  // ✅ NEW: SCHOOL ENDPOINTS
  // ==========================================

  // 5 urinish / 60 soniya — brute-force himoya
  @Post('school/login')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  async loginSchool(@Body() loginDto: LoginDto) {
    return this.authService.loginSchool(loginDto);
  }

  @Get('school/me')
  @UseGuards(JwtAuthGuard)
  async getSchoolProfile(@Request() req) {
    // Check if token is for School
    if (req.user.type !== 'SCHOOL') {
      return { error: 'Not a school token' };
    }
    return this.authService.validateSchool(req.user.schoolId);
  }

  @Post('school/refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async refreshSchool(@Request() req) {
    // Check if token is for School
    if (req.user.type !== 'SCHOOL') {
      return { error: 'Not a school token' };
    }
    return this.authService.refreshSchoolToken(req.user.schoolId);
  }

  @Post('school/change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changeSchoolPassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    // Check if token is for School
    if (req.user.type !== 'SCHOOL') {
      return { error: 'Not a school token' };
    }
    return this.authService.changeSchoolPassword(
      req.user.schoolId,
      changePasswordDto.oldPassword,
      changePasswordDto.newPassword,
    );
  }
}