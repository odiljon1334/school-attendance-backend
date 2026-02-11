import { Module } from '@nestjs/common';
import { EnrollPicService } from './enroll-pic.service';
import { EnrollPicController } from './enroll-pic.controller';

@Module({
  providers: [EnrollPicService],
  controllers: [EnrollPicController]
})
export class EnrollPicModule {}
