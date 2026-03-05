import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

// Public routelar — JWT skip
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/school/login',
  '/auth/register',
  '/whatsapp/webhook',
  '/webhooks/payment',
  '/hikvision/webhook',
];

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const path: string = request.path ?? '';

    // Public routelarda JWT tekshirmaymiz
    if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid or missing token');
    }
    return user;
  }
}