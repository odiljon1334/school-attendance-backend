import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
  
    if (!requiredRoles) return true;
  
    const request = context.switchToHttp().getRequest();
    const user = request.user;
  
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
  
    // ✅ SCHOOL token — role yo'q, lekin o'z schoolId ga kirishi mumkin
    if (user.type === 'SCHOOL') {
      return true; // SchoolAccessGuard alohida tekshiradi
    }
  
    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(`Access denied. Required roles: ${requiredRoles.join(', ')}`);
    }
  
    return true;
  }
}