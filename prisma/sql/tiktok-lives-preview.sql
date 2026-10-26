-- Additive migration for databases created before live previews. Run once (SQLite has no ADD COLUMN IF NOT EXISTS).
ALTER TABLE "TikTokLive" ADD COLUMN "streamHlsUrl" TEXT;
ALTER TABLE "TikTokLive" ADD COLUMN "streamFlvUrl" TEXT;
