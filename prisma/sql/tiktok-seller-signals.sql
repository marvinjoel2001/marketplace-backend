-- Additive migration for databases created before seller signals (video captions and live chat).
-- Run once (SQLite has no ADD COLUMN IF NOT EXISTS). New databases use `npm run prisma:push`.
ALTER TABLE "TikTokLive" ADD COLUMN "city" TEXT;
CREATE TABLE IF NOT EXISTS "TikTokSellerSignal" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "videoSelling" BOOLEAN,
    "videoKeywords" TEXT NOT NULL DEFAULT '[]',
    "videoCheckedAt" DATETIME,
    "chatSelling" BOOLEAN,
    "chatRoomId" TEXT,
    "chatHits" INTEGER NOT NULL DEFAULT 0,
    "chatCheckedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
