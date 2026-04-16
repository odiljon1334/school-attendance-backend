import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface CreateCameraDto {
  schoolId: string;
  name: string;
  rtspUrl?: string;
  streamPath?: string;
  location?: string;
  isActive?: boolean;
}

export interface UpdateCameraDto {
  name?: string;
  rtspUrl?: string;
  streamPath?: string;
  location?: string;
  isActive?: boolean;
}

@Injectable()
export class CamerasService {
  private readonly mediamtxHost: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.mediamtxHost = this.config.get('MEDIAMTX_HLS_HOST', 'http://localhost:8888');
  }

  async findBySchool(schoolId: string) {
    const cams = await this.prisma.schoolCamera.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'asc' },
    });
    return cams.map(c => this.withLiveUrl(c));
  }

  async findOne(id: string) {
    const cam = await this.prisma.schoolCamera.findUnique({ where: { id } });
    if (!cam) throw new NotFoundException('Камера не найдена');
    return this.withLiveUrl(cam);
  }

  async create(dto: CreateCameraDto) {
    const cam = await this.prisma.schoolCamera.create({ data: dto });
    return this.withLiveUrl(cam);
  }

  async update(id: string, dto: UpdateCameraDto) {
    await this.findOne(id);
    const cam = await this.prisma.schoolCamera.update({ where: { id }, data: dto });
    return this.withLiveUrl(cam);
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.schoolCamera.delete({ where: { id } });
  }

  // ─── Live URL (HLS via MediaMTX) ────────────────────────────────────────────
  getLiveUrl(cam: { streamPath?: string | null }): string | null {
    if (!cam.streamPath || !this.mediamtxHost) return null;
    const host = this.mediamtxHost.replace(/\/$/, '');
    return `${host}/${cam.streamPath}/index.m3u8`;
  }

  private withLiveUrl(cam: any) {
    return { ...cam, liveUrl: this.getLiveUrl(cam) };
  }
}
