-- Additive migration for existing SQLite installations. Existing Store data is preserved.
CREATE TABLE IF NOT EXISTS "TikTokAccount" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "countryCode" TEXT NOT NULL DEFAULT 'BO',
    "storeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TikTokAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TikTokAccount_storeId_key" ON "TikTokAccount"("storeId");
CREATE TABLE IF NOT EXISTS "TikTokLive" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "avatarUrl" TEXT,
    "coverImageUrl" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL DEFAULT 'Otros',
    "isSelling" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT NOT NULL DEFAULT 'BO',
    "geoEvidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" DATETIME NOT NULL,
    "storeId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TikTokLive_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TikTokLive_status_isSelling_countryCode_verifiedAt_idx" ON "TikTokLive"("status", "isSelling", "countryCode", "verifiedAt");
