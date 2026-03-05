import { Module } from '@nestjs/common';
import { CsvImportService } from './csv-import.service';
import { CsvImportController } from './csv-import.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CsvImportController],
  providers: [CsvImportService],
  exports: [CsvImportService],
})
export class CsvImportModule {}