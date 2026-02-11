import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    HttpCode,
    HttpStatus,
    Query,
  } from '@nestjs/common';
  import { HikvisionService } from './hikvision.service';
  import { CreateDeviceDto, UpdateDeviceDto, RegisterFaceDto } from './dto/hikvision.dto';
  import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
  import { RolesGuard } from '../auth/guards/roles.guard';
  import { Roles } from '../auth/decorators/roles.decorator';
  import { UserRole } from '@prisma/client';
  
  @Controller('hikvision')
  export class HikvisionController {
    constructor(private readonly hikvisionService: HikvisionService) {}
  
    // ────────────────────────────────────────────────────────
    // DEVICE MANAGEMENT (Protected)
    // ────────────────────────────────────────────────────────
  
    @Post('devices')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    createDevice(@Body() createDeviceDto: CreateDeviceDto) {
      console.log('createDevice => Body:', createDeviceDto)
      return this.hikvisionService.createDevice(createDeviceDto);
    }

    @Get('devices')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
    findAllDevices(@Query('schoolId') schoolId?: string) {
      return this.hikvisionService.findAll(schoolId);
    }
    
    @Get('devices/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
    findOneDevice(@Param('id') id: string) {
      return this.hikvisionService.findOne(id);
    }
  
    @Get('devices/:id/test')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    testDevice(@Param('id') id: string) {
      console.log('Device Test Endpoint:', id)
      return this.hikvisionService.testDevice(id);
    }
  
    @Patch('devices/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    updateDevice(@Param('id') id: string, @Body() updateDeviceDto: UpdateDeviceDto) {
      return this.hikvisionService.update(id, updateDeviceDto);
    }
  
    @Delete('devices/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    @HttpCode(HttpStatus.OK)
    removeDevice(@Param('id') id: string) {
      return this.hikvisionService.remove(id);
    }
  
    // ────────────────────────────────────────────────────────
    // FACE REGISTRATION (Protected)
    // ────────────────────────────────────────────────────────
  
    @Post('face/register')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
    @HttpCode(HttpStatus.OK)
    registerFace(@Body() registerFaceDto: RegisterFaceDto) {
      return this.hikvisionService.registerFace(registerFaceDto);
    }
  
    @Delete('face/:deviceId/:personId')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
    @HttpCode(HttpStatus.OK)
    deleteFace(@Param('deviceId') deviceId: string, @Param('personId') personId: string) {
      return this.hikvisionService.deleteFace(deviceId, personId);
    }
  
    // ────────────────────────────────────────────────────────
    // WEBHOOK (Public - Called by Hikvision device)
    // ────────────────────────────────────────────────────────
  
    @Post('webhook/face-recognition')
    @HttpCode(HttpStatus.OK)
    handleFaceRecognitionWebhook(@Body() event: any) {
      return this.hikvisionService.handleFaceRecognitionEvent(event);
    }
  }