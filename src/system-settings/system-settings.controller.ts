import { Body, Controller, Get, Patch, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSystemSettingsDto {
  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;
}

@Controller('system-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SystemSettingsController {
  constructor(private readonly service: SystemSettingsService) {}

  // Any admin can read settings
  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getSettings() {
    return this.service.get();
  }

  // Only SUPER_ADMIN can update settings
  @Patch()
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() dto: UpdateSystemSettingsDto) {
    return this.service.update(dto);
  }
}
