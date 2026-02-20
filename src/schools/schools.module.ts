import { Module } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { SchoolsController } from './schools.controller';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  providers: [SchoolsService],
  controllers: [SchoolsController],
})
export class SchoolsModule {}
