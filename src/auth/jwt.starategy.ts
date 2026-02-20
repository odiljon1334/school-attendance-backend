// src/auth/strategies/jwt.strategy.ts - UPDATED (User + School)

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    });
  }

  async validate(payload: any) {
    // ==========================================
    // ✅ SCHOOL TOKEN
    // ==========================================
    if (payload.type === 'SCHOOL') {
      const school = await this.prisma.school.findUnique({
        where: { id: payload.schoolId },
        select: {
          id: true,
          name: true,
          code: true,
          username: true,
        },
      });

      if (!school) {
        throw new UnauthorizedException('School not found');
      }

      return {
        sub: payload.sub,
        schoolId: payload.schoolId,
        schoolName: payload.schoolName,
        schoolCode: payload.schoolCode,
        type: 'SCHOOL',
      };
    }

    // ==========================================
    // ✅ USER TOKEN (existing)
    // ==========================================
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is not active');
    }

    return {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      type: 'USER',
    };
  }
}