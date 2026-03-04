import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { GenerateBillingDto } from './dto/generate-billing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('generate')
  generate(@Body() dto: GenerateBillingDto) {
    return this.billing.generate(dto);
  }
}