import {
  Controller,
  Headers,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CamerasService,
  CreateCameraDto,
  UpdateCameraDto,
} from './cameras.service';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('cameras')
export class CamerasController {
  constructor(
    private readonly svc: CamerasService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  findAll(@Query('schoolId') schoolId: string) {
    return this.svc.findBySchool(schoolId);
  }

  @Get('active')
  @SkipThrottle()
  @Public()
  async getActiveCameras(
    @Headers('x-service-token') token: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const secret = this.config.get<string>('AI_SERVICE_TOKEN');
    if (secret && token !== secret) {
      throw new UnauthorizedException('Invalid service token');
    }
    return this.svc.findActiveCameras(schoolId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCameraDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCameraDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
