import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePaymentDto,
  UpdatePaymentDto,
  PaymentReportDto,
} from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async create(createPaymentDto: CreatePaymentDto) {
    const { studentId, amount, paymentDate, status, type, description } =
      createPaymentDto;

    // Check if student exists
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        school: { select: { id: true, name: true } },
        class: { select: { grade: true, section: true } },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const payment = await this.prisma.paymentRecord.create({
      data: {
        studentId,
        amount,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        status: status || 'UNPAID',
        type,
        description,
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: {
              select: { grade: true, section: true },
            },
          },
        },
      },
    });

    return payment;
  }

  async findAll(
    schoolId?: string,
    studentId?: string,
    classId?: string,
    status?: string,
    type?: string,
  ) {
    const where: any = {};

    if (studentId) {
      where.studentId = studentId;
    }

    if (schoolId) {
      where.student = { schoolId };
    }

    if (classId) {
      where.student = { ...where.student, classId };
    }

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    return this.prisma.paymentRecord.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            school: { select: { id: true, name: true } },
            class: { select: { grade: true, section: true } },
          },
        },
      },
      orderBy: { paymentDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const payment = await this.prisma.paymentRecord.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            school: { select: { id: true, name: true } },
            class: { select: { grade: true, section: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    return payment;
  }

  async update(id: string, updatePaymentDto: UpdatePaymentDto) {
    await this.findOne(id);

    const updateData: any = {};

    if (updatePaymentDto.amount !== undefined) {
      updateData.amount = updatePaymentDto.amount;
    }

    if (updatePaymentDto.status) {
      updateData.status = updatePaymentDto.status;
    }

    if (updatePaymentDto.paymentDate) {
      updateData.paymentDate = new Date(updatePaymentDto.paymentDate);
    }

    if (updatePaymentDto.type) {
      updateData.type = updatePaymentDto.type;
    }

    if (updatePaymentDto.description !== undefined) {
      updateData.description = updatePaymentDto.description;
    }

    return this.prisma.paymentRecord.update({
      where: { id },
      data: updateData,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: { select: { grade: true, section: true } },
          },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.paymentRecord.delete({ where: { id } });

    return { message: 'Payment record deleted successfully' };
  }

  // Mark payment as paid
  async markAsPaid(id: string) {
    const payment = await this.findOne(id);

    if (payment.status === 'PAID') {
      throw new BadRequestException('Payment is already paid');
    }

    return this.prisma.paymentRecord.update({
      where: { id },
      data: {
        status: 'PAID',
        paymentDate: new Date(),
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: { select: { grade: true, section: true } },
          },
        },
      },
    });
  }

  // Mark as overdue
  async markAsOverdue(id: string) {
    const payment = await this.findOne(id);

    if (payment.status === 'PAID') {
      throw new BadRequestException('Cannot mark paid payment as overdue');
    }

    return this.prisma.paymentRecord.update({
      where: { id },
      data: { status: 'OVERDUE' },
    });
  }

  // Generate payment report
  async generateReport(reportDto: PaymentReportDto) {
    const { schoolId, startDate, endDate, classId, studentId, status, type } =
      reportDto;

    const where: any = {
      student: { schoolId },
    };

    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = new Date(startDate);
      if (endDate) where.paymentDate.lte = new Date(endDate);
    }

    if (classId) {
      where.student.classId = classId;
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    const payments = await this.prisma.paymentRecord.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: { select: { grade: true, section: true } },
          },
        },
      },
      orderBy: { paymentDate: 'desc' },
    });

    // Calculate summary
    const summary = {
      totalRecords: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
      paidAmount: payments
        .filter((p) => p.status === 'PAID')
        .reduce((sum, p) => sum + p.amount, 0),
      unpaidAmount: payments
        .filter((p) => p.status === 'UNPAID')
        .reduce((sum, p) => sum + p.amount, 0),
      overdueAmount: payments
        .filter((p) => p.status === 'OVERDUE')
        .reduce((sum, p) => sum + p.amount, 0),
      partialAmount: payments
        .filter((p) => p.status === 'PARTIAL')
        .reduce((sum, p) => sum + p.amount, 0),
      byStatus: {
        paid: payments.filter((p) => p.status === 'PAID').length,
        unpaid: payments.filter((p) => p.status === 'UNPAID').length,
        overdue: payments.filter((p) => p.status === 'OVERDUE').length,
        partial: payments.filter((p) => p.status === 'PARTIAL').length,
      },
      byType: payments.reduce(
        (acc, p) => {
          if (!acc[p.type]) {
            acc[p.type] = { count: 0, totalAmount: 0, paidAmount: 0 };
          }
          acc[p.type].count++;
          acc[p.type].totalAmount += p.amount;
          if (p.status === 'PAID') acc[p.type].paidAmount += p.amount;
          return acc;
        },
        {} as Record<
          string,
          { count: number; totalAmount: number; paidAmount: number }
        >,
      ),
    };

    return { summary, payments };
  }

  // Get unpaid students for a school
  async getUnpaidStudents(schoolId: string, type?: string) {
    const where: any = {
      student: { schoolId },
      status: { in: ['UNPAID', 'OVERDUE'] },
    };

    if (type) {
      where.type = type;
    }

    const unpaidPayments = await this.prisma.paymentRecord.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            isTelegramSubscribed: true,
            class: { select: { grade: true, section: true } },
            parents: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
                relationship: true,
                isTelegramSubscribed: true,
              },
            },
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });

    // Group by student
    const studentMap = new Map();

    unpaidPayments.forEach((payment) => {
      const studentId = payment.student.id;
      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          student: payment.student,
          payments: [],
          totalUnpaid: 0,
        });
      }
      studentMap.get(studentId).payments.push(payment);
      studentMap.get(studentId).totalUnpaid += payment.amount;
    });

    return Array.from(studentMap.values());
  }
}
