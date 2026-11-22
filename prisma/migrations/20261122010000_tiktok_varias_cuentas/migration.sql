-- A store can link several TikTok accounts (each account still belongs to a single store).
DROP INDEX "TikTokAccount_storeId_key";

-- CreateIndex
CREATE INDEX "TikTokAccount_storeId_idx" ON "TikTokAccount"("storeId");

-- The username a store already typed becomes one of its linked accounts.
INSERT INTO "TikTokAccount" ("username", "countryCode", "storeId", "createdAt", "updatedAt")
SELECT lower(trim(both '@' from s."tiktokUsername")), 'BO', s."id", s."createdAt", CURRENT_TIMESTAMP
FROM "Store" s
WHERE s."tiktokUsername" IS NOT NULL
  AND lower(trim(both '@' from s."tiktokUsername")) ~ '^[a-z0-9_][a-z0-9_.]{0,23}$'
ON CONFLICT ("username") DO NOTHING;
