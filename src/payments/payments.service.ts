import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto, UpdatePaymentDto, PaymentReportDto } from './dto/payment.dto';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePaymentDto) {
    // 1. Talabani tekshirish
    const student = await this.prisma.student.findUnique({ where: { id: dto.studentId } });
    if (!student) throw new NotFoundException('Student not found');

    // 2. Bir oy uchun takroriy to'lovni tekshirish (Schema constraint: studentId_month)
    const existing = await this.prisma.payment.findFirst({
      where: { studentId: dto.studentId, month: dto.month }
    });
    if (existing) throw new BadRequestException(`Payment for ${dto.month} already exists for this student`);

    return this.prisma.payment.create({
      data: {
        studentId: dto.studentId,
        amount: dto.amount,
        month: dto.month,
        academicYear: dto.academicYear,
        status: dto.status || PaymentStatus.PENDING,
        paidDate: dto.paymentDate ? new Date(dto.paymentDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : new Date(),
        notes: dto.notes,
      }
    });
  }

  async findAll(schoolId?: string, studentId?: string, classId?: string, status?: string) {
    const where: any = {};
    if (studentId) where.studentId = studentId;
    if (status) where.status = status as PaymentStatus;
    
    // Relation orqali filtrlash
    if (schoolId || classId) {
      where.student = {
        ...(schoolId && { schoolId }),
        ...(classId && { classId }),
      };
    }

    return this.prisma.payment.findMany({
      where,
      include: {
        student: {
          select: { firstName: true, lastName: true, class: { select: { grade: true, section: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async markAsPaid(id: string) {
    const payment = await this.findOne(id);
    if (payment.status === PaymentStatus.PAID) throw new BadRequestException('Already paid');

    return this.prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.PAID, paidDate: new Date() }
    });
  }

  async getUnpaidStudents(schoolId: string) {
    // FAQAT to'lanmaganlarni filterlash
    const unpaid = await this.prisma.payment.findMany({
      where: {
        student: { schoolId },
        status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] }
      },
      include: {
        student: { include: { class: true, parents: true } }
      }
    });

    // Gruhlash (optional, UI talabiga qarab)
    return unpaid;
  }

  async generateReport(dto: PaymentReportDto) {
    return this.prisma.payment.findMany({
      where: {
        student: { schoolId: dto.schoolId },
        status: dto.status,
        createdAt: {
          gte: dto.startDate ? new Date(dto.startDate) : undefined,
          lte: dto.endDate ? new Date(dto.endDate) : undefined,
        }
      }
    });
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: { student: true } });
    if (!payment) throw new NotFoundException('Payment record not found');
    return payment;
  }

  async update(id: string, dto: UpdatePaymentDto) {
    await this.findOne(id);
    return this.prisma.payment.update({
      where: { id },
      data: {
        amount: dto.amount,
        status: dto.status,
        notes: dto.notes,
        paidDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined
      }
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.payment.delete({ where: { id } });
  }
}