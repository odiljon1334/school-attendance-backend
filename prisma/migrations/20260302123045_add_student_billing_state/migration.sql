-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "billingPaidUntil" TIMESTAMP(3),
ADD COLUMN     "billingPlan" "BillingPlan" NOT NULL DEFAULT 'MONTHLY';

-- CreateIndex
CREATE INDEX "Student_billingPaidUntil_idx" ON "Student"("billingPaidUntil");
