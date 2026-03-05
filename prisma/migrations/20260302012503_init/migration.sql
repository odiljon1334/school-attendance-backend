-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'DIRECTOR', 'TEACHER', 'STUDENT', 'PARENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "PaymentWaiveReason" AS ENUM ('LOW_INCOME', 'SIBLING_DISCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "ParentRelation" AS ENUM ('FATHER', 'MOTHER', 'PARENT');

-- CreateEnum
CREATE TYPE "TeacherType" AS ENUM ('TEACHER', 'DIRECTOR');

-- CreateEnum
CREATE TYPE "TurnstilePersonType" AS ENUM ('STUDENT', 'TEACHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "districtId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "username" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender" NOT NULL,
    "phone" TEXT,
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "telegramChatId" TEXT,
    "isTelegramActive" BOOLEAN NOT NULL DEFAULT false,
    "photo" TEXT,
    "facePersonId" TEXT,
    "enrollNumber" TEXT,
    "importKey" TEXT,
    "isSmsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsPaidUntil" TIMESTAMP(3),
    "smsPaymentType" TEXT,
    "smsReminderSent" BOOLEAN NOT NULL DEFAULT false,
    "isLowIncome" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentParent" (
    "studentId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "notifySms" BOOLEAN NOT NULL DEFAULT false,
    "isBillingPayer" BOOLEAN NOT NULL DEFAULT false,
    "relationship" "ParentRelation" NOT NULL DEFAULT 'PARENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentParent_pkey" PRIMARY KEY ("studentId","parentId")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "TeacherType" NOT NULL DEFAULT 'TEACHER',
    "schoolId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "telegramChatId" TEXT,
    "isTelegramActive" BOOLEAN NOT NULL DEFAULT false,
    "photo" TEXT,
    "facePersonId" TEXT,
    "enrollNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherClass" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_schedules" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "workDays" JSONB NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "hoursPerDay" DOUBLE PRECISION NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "hoursPerMonth" DOUBLE PRECISION NOT NULL,
    "baseSalary" DOUBLE PRECISION NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_attendances" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkInTime" TIMESTAMP(3),
    "checkOutTime" TIMESTAMP(3),
    "workDuration" DOUBLE PRECISION,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "leftEarly" BOOLEAN NOT NULL DEFAULT false,
    "earlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_payrolls" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "expectedHours" DOUBLE PRECISION NOT NULL,
    "baseSalary" DOUBLE PRECISION NOT NULL,
    "totalDaysWorked" INTEGER NOT NULL,
    "totalHoursWorked" DOUBLE PRECISION NOT NULL,
    "lateDays" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveDays" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "absentDays" INTEGER NOT NULL DEFAULT 0,
    "missedHours" DOUBLE PRECISION NOT NULL,
    "penaltyAmount" DOUBLE PRECISION NOT NULL,
    "bonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusReason" TEXT,
    "actualSalary" DOUBLE PRECISION NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT NOT NULL,
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "telegramChatId" TEXT,
    "isTelegramActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkInTime" TIMESTAMP(3),
    "checkOutTime" TIMESTAMP(3),
    "lateMinutes" INTEGER,
    "lateCount" INTEGER NOT NULL DEFAULT 0,
    "deviceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL,
    "amount" INTEGER NOT NULL,
    "periodKey" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidDate" TIMESTAMP(3),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "waiveReason" "PaymentWaiveReason",
    "waivedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifyCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentVia" TEXT NOT NULL,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramSession" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "userId" TEXT,
    "userType" TEXT,
    "state" TEXT NOT NULL DEFAULT 'START',
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HikvisionDevice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 80,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HikvisionDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnstileIdentity" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "personType" "TurnstilePersonType" NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurnstileIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollCounter" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentSeq" INTEGER NOT NULL DEFAULT 0,
    "staffSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrollCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "District_code_key" ON "District"("code");

-- CreateIndex
CREATE UNIQUE INDEX "School_code_key" ON "School"("code");

-- CreateIndex
CREATE UNIQUE INDEX "School_username_key" ON "School"("username");

-- CreateIndex
CREATE INDEX "School_username_idx" ON "School"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Class_schoolId_grade_section_academicYear_key" ON "Class"("schoolId", "grade", "section", "academicYear");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_telegramId_key" ON "Student"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_facePersonId_key" ON "Student"("facePersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_enrollNumber_key" ON "Student"("enrollNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Student_importKey_key" ON "Student"("importKey");

-- CreateIndex
CREATE INDEX "Student_classId_idx" ON "Student"("classId");

-- CreateIndex
CREATE INDEX "Student_isSmsEnabled_idx" ON "Student"("isSmsEnabled");

-- CreateIndex
CREATE INDEX "Student_smsPaidUntil_idx" ON "Student"("smsPaidUntil");

-- CreateIndex
CREATE INDEX "Student_isLowIncome_idx" ON "Student"("isLowIncome");

-- CreateIndex
CREATE INDEX "StudentParent_parentId_idx" ON "StudentParent"("parentId");

-- CreateIndex
CREATE INDEX "StudentParent_studentId_idx" ON "StudentParent"("studentId");

-- CreateIndex
CREATE INDEX "StudentParent_isBillingPayer_idx" ON "StudentParent"("isBillingPayer");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_userId_key" ON "Teacher"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_facePersonId_key" ON "Teacher"("facePersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_enrollNumber_key" ON "Teacher"("enrollNumber");

-- CreateIndex
CREATE INDEX "Teacher_facePersonId_idx" ON "Teacher"("facePersonId");

-- CreateIndex
CREATE INDEX "Teacher_type_idx" ON "Teacher"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_telegramId_key" ON "Teacher"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherClass_teacherId_classId_key" ON "TeacherClass"("teacherId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_schedules_teacherId_key" ON "teacher_schedules"("teacherId");

-- CreateIndex
CREATE INDEX "teacher_attendances_teacherId_date_idx" ON "teacher_attendances"("teacherId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendances_teacherId_date_key" ON "teacher_attendances"("teacherId", "date");

-- CreateIndex
CREATE INDEX "teacher_payrolls_teacherId_month_idx" ON "teacher_payrolls"("teacherId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_payrolls_teacherId_month_key" ON "teacher_payrolls"("teacherId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Parent_userId_key" ON "Parent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Parent_phone_key" ON "Parent"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Parent_telegramId_key" ON "Parent"("telegramId");

-- CreateIndex
CREATE INDEX "Attendance_schoolId_date_idx" ON "Attendance"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_studentId_date_key" ON "Attendance"("studentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_teacherId_date_key" ON "Attendance"("teacherId", "date");

-- CreateIndex
CREATE INDEX "Payment_studentId_idx" ON "Payment"("studentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_plan_periodKey_idx" ON "Payment"("plan", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_studentId_plan_periodKey_key" ON "Payment"("studentId", "plan", "periodKey");

-- CreateIndex
CREATE INDEX "Notification_recipientId_isSent_idx" ON "Notification"("recipientId", "isSent");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramSession_chatId_key" ON "TelegramSession"("chatId");

-- CreateIndex
CREATE INDEX "TelegramSession_chatId_idx" ON "TelegramSession"("chatId");

-- CreateIndex
CREATE INDEX "TelegramSession_telegramId_idx" ON "TelegramSession"("telegramId");

-- CreateIndex
CREATE INDEX "SmsLog_recipient_idx" ON "SmsLog"("recipient");

-- CreateIndex
CREATE INDEX "SmsLog_sentAt_idx" ON "SmsLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "HikvisionDevice_deviceId_key" ON "HikvisionDevice"("deviceId");

-- CreateIndex
CREATE INDEX "HikvisionDevice_schoolId_idx" ON "HikvisionDevice"("schoolId");

-- CreateIndex
CREATE INDEX "TurnstileIdentity_deviceId_idx" ON "TurnstileIdentity"("deviceId");

-- CreateIndex
CREATE INDEX "TurnstileIdentity_personType_idx" ON "TurnstileIdentity"("personType");

-- CreateIndex
CREATE INDEX "TurnstileIdentity_studentId_idx" ON "TurnstileIdentity"("studentId");

-- CreateIndex
CREATE INDEX "TurnstileIdentity_teacherId_idx" ON "TurnstileIdentity"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TurnstileIdentity_deviceId_employeeNo_key" ON "TurnstileIdentity"("deviceId", "employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "TurnstileIdentity_deviceId_studentId_key" ON "TurnstileIdentity"("deviceId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TurnstileIdentity_deviceId_teacherId_key" ON "TurnstileIdentity"("deviceId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollCounter_schoolId_key" ON "EnrollCounter"("schoolId");

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentParent" ADD CONSTRAINT "StudentParent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentParent" ADD CONSTRAINT "StudentParent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherClass" ADD CONSTRAINT "TeacherClass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherClass" ADD CONSTRAINT "TeacherClass_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_schedules" ADD CONSTRAINT "teacher_schedules_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_payrolls" ADD CONSTRAINT "teacher_payrolls_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parent" ADD CONSTRAINT "Parent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HikvisionDevice" ADD CONSTRAINT "HikvisionDevice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnstileIdentity" ADD CONSTRAINT "TurnstileIdentity_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "HikvisionDevice"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnstileIdentity" ADD CONSTRAINT "TurnstileIdentity_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnstileIdentity" ADD CONSTRAINT "TurnstileIdentity_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollCounter" ADD CONSTRAINT "EnrollCounter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
