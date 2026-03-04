import { Controller, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { TurnstileService } from './turnstile.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UploadTurnstilePhotoDto, UpdateTurnstilePhotoDto, SyncSchoolPhotosDto } from './dto/turnstile.dto';

@Controller('turnstile')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TurnstileController {
  constructor(private readonly turnstileService: TurnstileService) {}

  @Post('upload')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async uploadPhoto(@Body() body: UploadTurnstilePhotoDto) {
    const success = await this.turnstileService.uploadPhoto(
      body.userId,
      body.photo,
      body.userType,
    );

    return {
      success,
      message: success ? 'Photo uploaded successfully' : 'Failed to upload photo',
    };
  }

  @Delete('remove/:userId/:userType')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async removePhoto(
    @Param('userId') userId: string,
    @Param('userType') userType: 'student' | 'teacher' | 'director',
  ) {
    const success = await this.turnstileService.removePhoto(userId, userType);

    return {
      success,
      message: success ? 'Photo removed successfully' : 'Failed to remove photo',
    };
  }

  @Post('update')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async updatePhoto(@Body() body: UpdateTurnstilePhotoDto) {
    const success = await this.turnstileService.updatePhoto(
      body.userId,
      body.photo,
      body.userType,
    );

    return {
      success,
      message: success ? 'Photo updated successfully' : 'Failed to update photo',
    };
  }

  @Post('sync/:schoolId')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async syncSchoolPhotos(
    @Param('schoolId') schoolId: string,
    @Body() body: SyncSchoolPhotosDto,
  ) {
    await this.turnstileService.syncSchoolPhotos(schoolId, body.users);

    return {
      message: 'Sync completed',
      total: body.users.length,
    };
  }
}