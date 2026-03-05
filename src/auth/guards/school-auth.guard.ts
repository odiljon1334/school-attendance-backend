import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class SchoolAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Check if user exists and is a School
    if (!user || user.type !== 'SCHOOL') {
      throw new UnauthorizedException('School access required');
    }

    return true;
  }
}