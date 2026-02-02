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
} from '@nestjs/common';
import { DistrictsService } from './districts.service';
import { CreateDistrictDto, UpdateDistrictDto } from './dto/district.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('districts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DistrictsController {
  constructor(private readonly districtsService: DistrictsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDistrictDto: CreateDistrictDto) {
    return this.districtsService.create(createDistrictDto);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  findAll() {
    return this.districtsService.findAll();
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  findOne(@Param('id') id: string) {
    return this.districtsService.findOne(id);
  }

  @Get(':id/statistics')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  getStatistics(@Param('id') id: string) {
    return this.districtsService.getStatistics(id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateDistrictDto: UpdateDistrictDto,
  ) {
    return this.districtsService.update(id, updateDistrictDto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.districtsService.remove(id);
  }
}
