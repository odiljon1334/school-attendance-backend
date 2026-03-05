import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EnrollPicService } from './enroll-pic.service';
import * as fs from 'fs';

@Controller('enroll-pic')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollPicController {
  constructor(private enrollPicService: EnrollPicService) {}

  /**
   * Export photos for a school
   * GET /enroll-pic/school/:schoolId
   * Returns: enroll_pic.zip file
   */
  @Get('school/:schoolId')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async exportSchoolPhotos(
    @Param('schoolId') schoolId: string,
    @Res() res: Response,
  ) {
    try {
      const zipPath = await this.enrollPicService.exportSchoolPhotos(schoolId);

      // Send ZIP file
      res.download(zipPath, 'enroll_pic.zip', (err) => {
        // Cleanup after download
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
        if (err) {
          console.error('Download error:', err);
        }
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to export photos',
        error: error.message,
      });
    }
  }

  /**
   * Export photos for entire district
   * GET /enroll-pic/district/:districtId
   * Returns: enroll_pic_district.zip with school subfolders
   */
  @Get('district/:districtId')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN')
  async exportDistrictPhotos(
    @Param('districtId') districtId: string,
    @Res() res: Response,
  ) {
    try {
      const zipPath = await this.enrollPicService.exportDistrictPhotos(districtId);

      res.download(zipPath, `enroll_pic_district.zip`, (err) => {
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
        if (err) {
          console.error('Download error:', err);
        }
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to export district photos',
        error: error.message,
      });
    }
  }
}