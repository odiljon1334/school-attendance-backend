import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Query,
} from '@nestjs/common';
import { CamerasService, CreateCameraDto, UpdateCameraDto } from './cameras.service';

@Controller('cameras')
export class CamerasController {
  constructor(private readonly svc: CamerasService) {}

  @Get()
  findAll(@Query('schoolId') schoolId: string) {
    return this.svc.findBySchool(schoolId);
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
