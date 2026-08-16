import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  UnauthorizedException,
  Logger,
  Delete,
  Param,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly config: ConfigService,
  ) {}

  // ── Service token tekshiruvi (AI microservice uchun) ──────────────────────
  private verifyServiceToken(token?: string) {
    const secret = this.config.get<string>('AI_SERVICE_TOKEN');
    if (secret && token !== secret) {
      throw new UnauthorizedException('Invalid service token');
    }
  }

  // ── AI microservice endpointlari (JWT emas, service token) ───────────────

  // AI service startup da shu endpoint dan barcha embeddinglarni yuklaydi
  @Get('embeddings')
  @SkipThrottle()
  @Public()
  async getEmbeddings(
    @Headers('x-service-token') token: string,
    @Query('schoolId') schoolId?: string,
  ) {
    this.verifyServiceToken(token);
    return this.aiService.getAllEmbeddings(schoolId);
  }

  // AI service foto dan embedding yaratib so'raydi
  @Post('extract-embedding')
  @SkipThrottle()
  async extractEmbedding(
    @Headers('x-service-token') token: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() body: { photo: string },
  ) {
    this.verifyServiceToken(token);
    // Bu endpoint faqat AI service ichidan chaqiriladi
    // AI service o'zi InsightFace bilan embedding yaratadi
    // Bu yerda faqat proxy vazifasini o'taydi
    return { ok: true };
  }

  // ── Admin panel endpointlari (JWT) ────────────────────────────────────────

  // Maktab barcha o'quvchi/o'qituvchi fotolaridan embedding yaratish
  @Post('generate-embeddings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  async generateEmbeddings(@Body() body: { schoolId: string }) {
    this.logger.log(`Generate embeddings: schoolId=${body.schoolId}`);
    return this.aiService.generateEmbeddingsForSchool(body.schoolId);
  }

  // AI service holati
  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  async getStatus() {
    return this.aiService.getAiStatus();
  }

  // Embedding ni qayta yuklash (AI service ga signal)
  @Post('reload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  async reloadEmbeddings() {
    await this.aiService.reloadAiEmbeddings();
    return { ok: true };
  }

  // Bitta o'quvchi embeddingini o'chirish
  @Delete('embeddings/student/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  async deleteStudentEmbedding(@Param('id') id: string) {
    await this.aiService.deleteEmbedding(id, 'student');
    return { ok: true };
  }

  // Bitta o'qituvchi embeddingini o'chirish
  @Delete('embeddings/teacher/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  async deleteTeacherEmbedding(@Param('id') id: string) {
    await this.aiService.deleteEmbedding(id, 'teacher');
    return { ok: true };
  }

  // Eski snapshotlarni tozalash
  @Post('clean-snapshots')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  async cleanSnapshots(@Body() body: { daysOld?: number }) {
    return this.aiService.cleanOldSnapshots(body.daysOld ?? 1);
  }
}
