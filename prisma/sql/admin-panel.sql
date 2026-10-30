-- Additive migration for the /admin panel, WhatsApp login codes, driver tariffs and payouts.
-- Run once on databases created before it (SQLite has no ADD COLUMN IF NOT EXISTS). Existing data is preserved.
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" DATETIME;

ALTER TABLE "Store" ADD COLUMN "paymentMethods" TEXT NOT NULL DEFAULT 'CASH_ON_DELIVERY,QR_ON_DELIVERY';
ALTER TABLE "Store" ADD COLUMN "shippingBaseFare" REAL;
ALTER TABLE "Store" ADD COLUMN "shippingPerKm" REAL;
ALTER TABLE "Store" ADD COLUMN "statusReason" TEXT;

CREATE TABLE IF NOT EXISTS "AdminAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminAccount_username_key" ON "AdminAccount"("username");

CREATE TABLE IF NOT EXISTS "OtpCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OtpCode_phone_createdAt_idx" ON "OtpCode"("phone", "createdAt");

CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "storeId" TEXT,
    "amount" REAL NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Payout_storeId_kind_idx" ON "Payout"("storeId", "kind");
