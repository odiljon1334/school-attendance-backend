import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DirectorsService } from './directors.service';
import { CreateDirectorDto, UpdateDirectorDto } from './dto/director.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('directors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DirectorsController {
  constructor(private readonly directorsService: DirectorsService) {}

  // ✅ GET ME - Must be BEFORE @Get(':id') to avoid conflict
  @Get('me')
  @Roles('DIRECTOR', 'SCHOOL_ADMIN')
  async getMe(@Req() req: any) {
    const userId = req.user.id;
    
    // ✅ FIXED: Use getProfile instead of findByUserId
    return this.directorsService.getProfile(userId);
  }
  
  @Post()
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  create(@Body() createDirectorDto: CreateDirectorDto) {
    return this.directorsService.create(createDirectorDto);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'DIRECTOR')
  findAll(@Query('schoolId') schoolId?: string) {
    return this.directorsService.findAll(schoolId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'DIRECTOR')
  findOne(@Param('id') id: string) {
    return this.directorsService.findOne(id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  update(@Param('id') id: string, @Body() updateDirectorDto: UpdateDirectorDto) {
    return this.directorsService.update(id, updateDirectorDto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN')
  remove(@Param('id') id: string) {
    return this.directorsService.remove(id);
  }

  @Get(':id/attendance-stats')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'DIRECTOR')
  getAttendanceStats(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.directorsService.getAttendanceStats(
      id,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }
}