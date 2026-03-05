-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "externalOrderId" TEXT,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "transactionId" TEXT;
