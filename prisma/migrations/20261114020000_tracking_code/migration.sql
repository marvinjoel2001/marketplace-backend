-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "trackingCode" TEXT;

-- Existing orders get a link too: one code per purchase, one per single order.
UPDATE "Order" o SET "trackingCode" = t.code
FROM (
  SELECT "purchaseId", substr(md5(random()::text || clock_timestamp()::text || "purchaseId"), 1, 22) AS code
  FROM "Order" WHERE "purchaseId" IS NOT NULL GROUP BY "purchaseId"
) t
WHERE o."purchaseId" = t."purchaseId";

UPDATE "Order" SET "trackingCode" = substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 22) WHERE "trackingCode" IS NULL;

-- CreateIndex
CREATE INDEX "Order_trackingCode_idx" ON "Order"("trackingCode");
