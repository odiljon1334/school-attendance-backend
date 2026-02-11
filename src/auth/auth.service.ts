import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/auth.dto';
import { RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
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
      const existingEmail = await this.prisma.user.findFirst({ // FIXED: Use findFirst
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
        email: registerDto.email || undefined, // Make optional
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

  async login(loginDto: LoginDto) {
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
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate token
    const token = this.generateToken(user);

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      access_token: token,
    };
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
        director: true,
        parent: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    return user;
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

  async resetPassword(email: string) {
    // Find user by email
    const user = await this.prisma.user.findFirst({ // FIXED: Use findFirst
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

    // TODO: Send email with tempPassword
    console.log(`Temporary password for ${email}: ${tempPassword}`);

    return { message: 'Password reset instructions sent' };
  }
}