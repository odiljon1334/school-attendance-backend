import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  UpdatePaymentDto,
  PaymentReportDto,
} from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Create payment record
  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  // Get all payment records with filters
  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  findAll(
    @Query('schoolId') schoolId?: string,
    @Query('studentId') studentId?: string,
    @Query('classId') classId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.paymentsService.findAll(
      schoolId,
      studentId,
      classId,
      status,
      type,
    );
  }

  // Get unpaid students
  @Get('unpaid/:schoolId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getUnpaidStudents(
    @Param('schoolId') schoolId: string,
    @Query('type') type?: string,
  ) {
    return this.paymentsService.getUnpaidStudents(schoolId, type);
  }

  // Generate report
  @Post('report')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  generateReport(@Body() reportDto: PaymentReportDto) {
    return this.paymentsService.generateReport(reportDto);
  }

  // Get single payment record
  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.PARENT,
  )
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  // Mark as paid
  @Post(':id/mark-paid')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  markAsPaid(@Param('id') id: string) {
    return this.paymentsService.markAsPaid(id);
  }

  // Mark as overdue
  @Post(':id/mark-overdue')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  markAsOverdue(@Param('id') id: string) {
    return this.paymentsService.markAsOverdue(id);
  }

  // Update payment record
  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  // Delete payment record
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.paymentsService.remove(id);
  }
}
