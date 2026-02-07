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
    Request,
  } from '@nestjs/common';
  import { UsersService } from './users.service';
  import { CreateUserDto, UpdateUserDto, ChangePasswordDto } from './dto/user.dto';
  import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
  import { RolesGuard } from '../auth/guards/roles.guard';
  import { Roles } from '../auth/decorators/roles.decorator';
  import { UserRole, UserStatus } from '@prisma/client';
  
  @Controller('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  export class UsersController {
    constructor(private readonly usersService: UsersService) {}
  
    @Post()
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    create(@Body() createUserDto: CreateUserDto) {
      return this.usersService.create(createUserDto);
    }
  
    @Get()
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    findAll(
      @Query('role') role?: UserRole,
      @Query('status') status?: UserStatus,
    ) {
      return this.usersService.findAll(role, status);
    }
  
    @Get('me')
    getProfile(@Request() req: any) {
      return this.usersService.findOne(req.user.userId);
    }
  
    @Get(':id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    findOne(@Param('id') id: string) {
      return this.usersService.findOne(id);
    }
  
    @Get(':id/statistics')
    getUserStatistics(@Param('id') id: string) {
      return this.usersService.getUserStatistics(id);
    }
  
    @Patch(':id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
      return this.usersService.update(id, updateUserDto);
    }
  
    @Post(':id/change-password')
    changePassword(
      @Param('id') id: string,
      @Body() changePasswordDto: ChangePasswordDto,
    ) {
      return this.usersService.changePassword(id, changePasswordDto);
    }
  
    @Post(':id/deactivate')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    deactivate(@Param('id') id: string) {
      return this.usersService.deactivate(id);
    }
  
    @Post(':id/activate')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    activate(@Param('id') id: string) {
      return this.usersService.activate(id);
    }
  
    @Post(':id/suspend')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
    suspend(@Param('id') id: string) {
      return this.usersService.suspend(id);
    }
  
    @Delete(':id')
    @Roles(UserRole.SUPER_ADMIN)
    remove(@Param('id') id: string) {
      return this.usersService.remove(id);
    }
  }