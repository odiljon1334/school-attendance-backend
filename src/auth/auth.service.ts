import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Check if username already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { username: registerDto.username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // Check email if provided
    if (registerDto.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: registerDto.email },
      });

      if (existingEmail) {
        throw new ConflictException('Email already exists');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user based on role
    const user = await this.prisma.user.create({
      data: {
        username: registerDto.username,
        email: registerDto.email,
        password: hashedPassword,
        role: registerDto.role,
        status: 'ACTIVE',
      },
    });

    // Create role-specific profile
    await this.createRoleProfile(user.id, registerDto);

    // Generate JWT token
    const token = this.generateToken(user.id, user.username, user.role);

    return {
      access_token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { username: loginDto.username },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    // Generate JWT token
    const token = this.generateToken(user.id, user.username, user.role);

    return {
      access_token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }

  private generateToken(
    userId: string,
    username: string,
    role: UserRole,
  ): string {
    const payload = { sub: userId, username, role };
    return this.jwtService.sign(payload);
  }

  private async createRoleProfile(userId: string, dto: RegisterDto) {
    switch (dto.role) {
      case UserRole.DISTRICT_ADMIN:
        if (!dto.districtId) {
          throw new BadRequestException(
            'District ID is required for District Admin',
          );
        }
        await this.prisma.districtAdmin.create({
          data: {
            userId,
            districtId: dto.districtId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
        });
        break;

      case UserRole.SCHOOL_ADMIN:
        if (!dto.schoolId) {
          throw new BadRequestException(
            'School ID is required for School Admin',
          );
        }
        await this.prisma.schoolAdmin.create({
          data: {
            userId,
            schoolId: dto.schoolId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
        });
        break;

      case UserRole.DIRECTOR:
        if (!dto.schoolId) {
          throw new BadRequestException('School ID is required for Director');
        }
        await this.prisma.director.create({
          data: {
            userId,
            schoolId: dto.schoolId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
        });
        break;

      case UserRole.TEACHER:
        if (!dto.schoolId) {
          throw new BadRequestException('School ID is required for Teacher');
        }
        await this.prisma.teacher.create({
          data: {
            userId,
            schoolId: dto.schoolId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            subjects: [],
          },
        });
        break;

      case UserRole.STUDENT:
        if (!dto.schoolId || !dto.classId) {
          throw new BadRequestException(
            'School ID and Class ID are required for Student',
          );
        }
        await this.prisma.student.create({
          data: {
            userId,
            schoolId: dto.schoolId,
            classId: dto.classId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
        });
        break;

      case UserRole.SUPER_ADMIN:
        // Super Admin doesn't need additional profile
        break;

      default:
        throw new BadRequestException('Invalid role');
    }
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
      },
    });
  }
}
