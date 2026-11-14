-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "purchaseId" TEXT,
ADD COLUMN     "combinedDelivery" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Order_purchaseId_idx" ON "Order"("purchaseId");
