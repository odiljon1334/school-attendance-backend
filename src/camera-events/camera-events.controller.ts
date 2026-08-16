// ─── camera-events.controller.ts ─────────────────────────────────────────────
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import {
  CameraEventsService,
  CameraEventPayload,
} from './camera-events.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('camera-events')
@SkipThrottle()
export class CameraEventsController {
  constructor(
    private readonly cameraEventsService: CameraEventsService,
    private readonly config: ConfigService,
  ) {}

  private verifyServiceToken(token?: string) {
    const secret = this.config.get<string>('AI_SERVICE_TOKEN');
    if (secret && token !== secret) {
      throw new UnauthorizedException('Invalid service token');
    }
  }

  // AI microservice shu endpoint ga event yuboradi
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleEvent(
    @Body() payload: CameraEventPayload,
    @Headers('x-service-token') token: string,
  ) {
    this.verifyServiceToken(token);
    return this.cameraEventsService.handleEvent(payload);
  }

  // TV dashboard — sinf xonasidagi bugungi presence statistika
  @Get('classroom/:cameraId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.MINISTRY,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  async getClassroomStats(@Param('cameraId') cameraId: string) {
    return this.cameraEventsService.getClassroomStats(cameraId);
  }
}
