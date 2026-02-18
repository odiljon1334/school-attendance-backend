-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "isSmsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smsPaidUntil" TIMESTAMP(3),
ADD COLUMN     "smsPaymentType" TEXT,
ADD COLUMN     "smsReminderSent" BOOLEAN NOT NULL DEFAULT false;
