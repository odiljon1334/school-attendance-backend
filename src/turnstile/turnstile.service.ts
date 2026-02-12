import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as sharp from 'sharp';

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly turnstileUrl: string;
  private readonly turnstileUsername: string;
  private readonly turnstilePassword: string;
  private readonly enabled: boolean;

  constructor(private configService: ConfigService) {
    this.turnstileUrl = this.configService.get('TURNSTILE_URL') || 'http://192.168.1.100';
    this.turnstileUsername = this.configService.get('TURNSTILE_USERNAME') || 'admin';
    this.turnstilePassword = this.configService.get('TURNSTILE_PASSWORD') || 'admin123';
    this.enabled = this.configService.get('TURNSTILE_ENABLED') === 'true';
  }

  /**
   * Upload photo to turnstile device
   * @param userId - Student/Teacher/Director ID
   * @param photo - Base64 encoded photo or file path
   * @param userType - 'student', 'teacher', 'director'
   */
  async uploadPhoto(userId: string, photo: string, userType: string = 'student'): Promise<boolean> {
    if (!this.enabled) {
      this.logger.warn('Turnstile is disabled');
      return false;
    }

    try {
      this.logger.log(`Uploading photo for ${userType} ${userId} to turnstile`);

      // 1. Process photo (convert to correct format)
      const processedPhoto = await this.processPhoto(photo, userId);

      // 2. Upload to turnstile device via API
      const response = await axios.post(
        `${this.turnstileUrl}/api/face/upload`,
        {
          userId: userId,
          userType: userType,
          photo: processedPhoto,
          fileName: `${userId}_2_0_${userId}_0.jpg`,
        },
        {
          auth: {
            username: this.turnstileUsername,
            password: this.turnstilePassword,
          },
          timeout: 30000, // 30 seconds
        }
      );

      if (response.status === 200) {
        this.logger.log(`Successfully uploaded photo for ${userId}`);
        return true;
      } else {
        this.logger.error(`Failed to upload photo: ${response.statusText}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error uploading photo for ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Remove photo from turnstile device
   * @param userId - Student/Teacher/Director ID
   */
  async removePhoto(userId: string): Promise<boolean> {
    if (!this.enabled) {
      this.logger.warn('Turnstile is disabled');
      return false;
    }

    try {
      this.logger.log(`Removing photo for user ${userId} from turnstile`);

      const response = await axios.delete(
        `${this.turnstileUrl}/api/face/delete/${userId}`,
        {
          auth: {
            username: this.turnstileUsername,
            password: this.turnstilePassword,
          },
          timeout: 10000,
        }
      );

      if (response.status === 200) {
        this.logger.log(`Successfully removed photo for ${userId}`);
        return true;
      } else {
        this.logger.error(`Failed to remove photo: ${response.statusText}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error removing photo for ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Update photo on turnstile device
   * @param userId - Student/Teacher/Director ID
   * @param photo - New photo (Base64 or file path)
   * @param userType - 'student', 'teacher', 'director'
   */
  async updatePhoto(userId: string, photo: string, userType: string = 'student'): Promise<boolean> {
    if (!this.enabled) {
      this.logger.warn('Turnstile is disabled');
      return false;
    }

    try {
      // Remove old photo first
      await this.removePhoto(userId);

      // Upload new photo
      return await this.uploadPhoto(userId, photo, userType);
    } catch (error) {
      this.logger.error(`Error updating photo for ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Process photo for turnstile requirements
   * - Format: JPEG
   * - Size: 400x500px (passport style)
   * - Quality: 85%
   * - Background: White/light gray
   */
  private async processPhoto(photo: string, userId: string): Promise<string> {
    try {
      let buffer: Buffer;

      // Convert photo to buffer
      if (photo.startsWith('data:image')) {
        // Base64 format
        const base64Data = photo.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else if (photo.startsWith('http://') || photo.startsWith('https://')) {
        // URL format
        const response = await axios.get(photo, { responseType: 'arraybuffer' });
        buffer = Buffer.from(response.data as ArrayBuffer);
      } else if (fs.existsSync(photo)) {
        // File path
        buffer = fs.readFileSync(photo);
        throw new Error('Invalid photo format');
      }

      // Process with sharp
      const processedBuffer = await sharp(buffer)
        .resize(400, 500, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({
          quality: 85,
          mozjpeg: true,
        })
        .toBuffer();

      // Convert to base64
      return processedBuffer.toString('base64');
    } catch (error) {
      this.logger.error(`Error processing photo for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Save photo locally for backup
   * File naming: {userId}_2_0_{userId}_0.jpg
   */
  async savePhotoLocally(userId: string, photo: string, schoolId: string): Promise<string> {
    try {
      const processedPhoto = await this.processPhoto(photo, userId);
      
      // Create directory structure
      const photoDir = path.join(process.cwd(), 'uploads', 'photos', schoolId);
      if (!fs.existsSync(photoDir)) {
        fs.mkdirSync(photoDir, { recursive: true });
      }

      // File name: {userId}_2_0_{userId}_0.jpg
      const fileName = `${userId}_2_0_${userId}_0.jpg`;
      const filePath = path.join(photoDir, fileName);

      // Save file
      const buffer = Buffer.from(processedPhoto, 'base64');
      fs.writeFileSync(filePath, buffer);

      this.logger.log(`Photo saved locally: ${filePath}`);
      return filePath;
    } catch (error) {
      this.logger.error(`Error saving photo locally for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Sync all photos for a school to turnstile
   */
  async syncSchoolPhotos(schoolId: string, users: Array<{ id: string; photo: string; type: string }>): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Turnstile is disabled');
      return;
    }

    this.logger.log(`Syncing ${users.length} photos for school ${schoolId}`);

    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      if (!user.photo) {
        this.logger.warn(`User ${user.id} has no photo, skipping`);
        continue;
      }

      const success = await this.uploadPhoto(user.id, user.photo, user.type);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Wait 500ms between uploads to avoid overwhelming the device
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.logger.log(`Sync completed: ${successCount} success, ${failCount} failed`);
  }

  /**
   * Test connection to turnstile device
   */
  async testConnection(): Promise<boolean> {
    if (!this.enabled) {
      this.logger.warn('Turnstile is disabled');
      return false;
    }

    try {
      const response = await axios.get(`${this.turnstileUrl}/api/health`, {
        auth: {
          username: this.turnstileUsername,
          password: this.turnstilePassword,
        },
        timeout: 5000,
      });

      if (response.status === 200) {
        this.logger.log('Turnstile connection successful');
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('Turnstile connection failed:', error.message);
      return false;
    }
  }
}