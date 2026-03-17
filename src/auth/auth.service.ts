import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/auth.dto';
import { RegisterDto } from './dto/auth.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private auditLog: AuditLogService,
  ) {}

  async register(registerDto: RegisterDto) {
    // Check if username exists
    const existingUsername = await this.prisma.user.findUnique({
      where: { username: registerDto.username },
    });

    if (existingUsername) {
      throw new ConflictException('Username already exists');
    }

    // Check if email exists (if provided)
    if (registerDto.email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email: registerDto.email },
      });

      if (existingEmail) {
        throw new ConflictException('Email already exists');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        username: registerDto.username,
        password: hashedPassword,
        email: registerDto.email || undefined,
        role: registerDto.role || 'STUDENT',
        status: 'ACTIVE',
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
      },
    });

    // Generate token
    const token = this.generateToken(user);

    return {
      user,
      access_token: token,
    };
  }

  async login(loginDto: LoginDto, ip?: string) {
    // Find user by username
    const user = await this.prisma.user.findUnique({
      where: { username: loginDto.username },
      select: {
        id: true,
        username: true,
        email: true,
        password: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      await this.auditLog.log({
        action: 'LOGIN_FAILED',
        entity: 'Auth',
        details: { username: loginDto.username, reason: 'user_not_found' },
        ip,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      await this.auditLog.log({
        action: 'LOGIN_FAILED',
        entity: 'Auth',
        entityId: user.id,
        details: { username: loginDto.username, reason: 'account_inactive' },
        ip,
        userId: user.id,
      });
      throw new UnauthorizedException('Account is not active');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      await this.auditLog.log({
        action: 'LOGIN_FAILED',
        entity: 'Auth',
        entityId: user.id,
        details: { username: loginDto.username, reason: 'wrong_password' },
        ip,
        userId: user.id,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.auditLog.log({
      action: 'LOGIN',
      entity: 'Auth',
      entityId: user.id,
      details: { username: user.username, role: user.role },
      ip,
      userId: user.id,
    });

    // Generate token
    const token = this.generateToken(user);

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      access_token: token,
    };
  }

  // ==========================================
  // ✅ NEW: SCHOOL LOGIN
  // ==========================================
  async loginSchool(loginDto: LoginDto) {
    // Find school by username
    const school = await this.prisma.school.findUnique({
      where: { username: loginDto.username },
      select: {
        id: true,
        name: true,
        code: true,
        username: true,
        password: true,
        address: true,
        phone: true,
        email: true,
        districtId: true,
      },
    });

    if (!school) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if school has password
    if (!school.password) {
      throw new UnauthorizedException('School login not configured');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(loginDto.password, school.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate token for School
    const token = this.generateSchoolToken(school);

    // Remove password from response
    const { password, ...schoolWithoutPassword } = school;

    return {
      school: schoolWithoutPassword,
      access_token: token,
      type: 'SCHOOL',
    };
  }

  // ==========================================
  // ✅ GENERATE SCHOOL TOKEN
  // ==========================================
  private generateSchoolToken(school: any): string {
    const payload = {
      sub: school.id,
      schoolId: school.id,
      schoolName: school.name,
      schoolCode: school.code,
      type: 'SCHOOL',
    };

    return this.jwtService.sign(payload);
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        student: true,
        teacher: true,
        parent: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    return user;
  }

  // ==========================================
  // ✅ NEW: VALIDATE SCHOOL
  // ==========================================
  async validateSchool(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        code: true,
        username: true,
        address: true,
        phone: true,
        email: true,
      },
    });

    if (!school) {
      throw new UnauthorizedException('School not found');
    }

    return school;
  }

  private generateToken(user: any): string {
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }

  async refreshToken(userId: string) {
    const user = await this.validateUser(userId);
    const token = this.generateToken(user);

    return {
      access_token: token,
    };
  }

  // ==========================================
  // ✅ NEW: REFRESH SCHOOL TOKEN
  // ==========================================
  async refreshSchoolToken(schoolId: string) {
    const school = await this.validateSchool(schoolId);
    const token = this.generateSchoolToken(school);

    return {
      access_token: token,
      type: 'SCHOOL',
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify old password
    const isValidPassword = await bcrypt.compare(oldPassword, user.password);
    if (!isValidPassword) {
      throw new UnauthorizedException('Old password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password changed successfully' };
  }

  // ==========================================
  // ✅ NEW: CHANGE SCHOOL PASSWORD
  // ==========================================
  async changeSchoolPassword(schoolId: string, oldPassword: string, newPassword: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school || !school.password) {
      throw new UnauthorizedException('School not found');
    }

    // Verify old password
    const isValidPassword = await bcrypt.compare(oldPassword, school.password);
    if (!isValidPassword) {
      throw new UnauthorizedException('Old password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await this.prisma.school.update({
      where: { id: schoolId },
      data: { password: hashedPassword },
    });

    return { message: 'School password changed successfully' };
  }

  async resetPassword(email: string) {
    // Find user by email
    const user = await this.prisma.user.findFirst({
      where: { email },
    });

    if (!user) {
      // Don't reveal if email exists or not
      return { message: 'If email exists, reset instructions will be sent' };
    }

    // TODO: Send password reset email
    // For now, generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // TODO: Send tempPassword via SMS/email to user

    return { message: 'Password reset instructions sent' };
  }
}