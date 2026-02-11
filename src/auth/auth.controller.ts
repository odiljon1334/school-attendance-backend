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
import { LoginDto } from './dto/auth.dto';
import { ChangePasswordDto } from 'src/users/dto/user.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@Request() req: any) {
    return this.authService.validateUser(req.user.id);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Request() req: any,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.id,
      dto.oldPassword,
      dto.newPassword,
    );
  }
}