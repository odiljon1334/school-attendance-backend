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
  import { ParentsService } from './parents.service';
  import { CreateParentDto, UpdateParentDto } from './dto/parent.dto';
  import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
  import { RolesGuard } from '../auth/guards/roles.guard';
  import { Roles } from '../auth/decorators/roles.decorator';
  import { UserRole } from '@prisma/client';
  
  @Controller('parents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  export class ParentsController {
    constructor(private readonly parentsService: ParentsService) {}
  
    @Post()
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    create(@Body() createParentDto: CreateParentDto) {
      return this.parentsService.create(createParentDto);
    }
  
    @Get()
    @Roles(
      UserRole.SUPER_ADMIN,
      UserRole.DISTRICT_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.DIRECTOR,
      UserRole.TEACHER,
    )
    findAll(
      @Query('studentId') studentId?: string,
      @Query('schoolId') schoolId?: string,
    ) {
      return this.parentsService.findAll(studentId, schoolId);
    }
  
    @Get('telegram-subscribed')
    @Roles(
      UserRole.SUPER_ADMIN,
      UserRole.DISTRICT_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.DIRECTOR,
    )
    getTelegramSubscribed(@Query('schoolId') schoolId?: string) {
      return this.parentsService.getTelegramSubscribed(schoolId);
    }
  
    @Get(':id')
    @Roles(
      UserRole.SUPER_ADMIN,
      UserRole.DISTRICT_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.DIRECTOR,
      UserRole.TEACHER,
      UserRole.PARENT,
    )
    findOne(@Param('id') id: string) {
      return this.parentsService.findOne(id);
    }
  
    @Get(':id/children')
    @Roles(
      UserRole.SUPER_ADMIN,
      UserRole.DISTRICT_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.DIRECTOR,
      UserRole.TEACHER,
      UserRole.PARENT,
    )
    getChildren(@Param('id') id: string) {
      return this.parentsService.getChildren(id);
    }
  
    @Patch(':id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    update(@Param('id') id: string, @Body() updateParentDto: UpdateParentDto) {
      return this.parentsService.update(id, updateParentDto);
    }
  
    @Delete(':id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    @HttpCode(HttpStatus.OK)
    remove(@Param('id') id: string) {
      return this.parentsService.remove(id);
    }
  }