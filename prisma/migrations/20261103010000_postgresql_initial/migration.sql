-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'TIKTOK',
    "phone" TEXT,
    "city" TEXT DEFAULT 'Santa Cruz de la Sierra',
    "zone" TEXT,
    "address" TEXT,
    "addressReference" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "nitOrCi" TEXT,
    "interestProfile" TEXT,
    "savedCart" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "phoneVerifiedAt" TIMESTAMP(3),
    "storeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT NOT NULL,
    "banner" TEXT,
    "description" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 4.8,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL DEFAULT -17.7833,
    "longitude" DOUBLE PRECISION NOT NULL DEFAULT -63.1821,
    "phone" TEXT,
    "tiktokUsername" TEXT,
    "tiktokLiveUrl" TEXT,
    "isLiveNow" BOOLEAN NOT NULL DEFAULT false,
    "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "customCommissionRate" DOUBLE PRECISION,
    "bankAccountInfo" TEXT,
    "payoutQr" TEXT,
    "addressReference" TEXT,
    "ownerId" TEXT,
    "deliveryDays" TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
    "deliveryStart" TEXT NOT NULL DEFAULT '09:00',
    "deliveryEnd" TEXT NOT NULL DEFAULT '18:00',
    "paymentMethods" TEXT NOT NULL DEFAULT 'CASH_ON_DELIVERY,QR_ON_DELIVERY',
    "shippingBaseFare" DOUBLE PRECISION,
    "shippingPerKm" DOUBLE PRECISION,
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokAccount" (
    "username" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'BO',
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokAccount_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "TikTokLive" (
    "username" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "avatarUrl" TEXT,
    "coverImageUrl" TEXT,
    "streamHlsUrl" TEXT,
    "streamFlvUrl" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL DEFAULT 'Otros',
    "isSelling" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT NOT NULL DEFAULT 'BO',
    "geoEvidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT,
    "city" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokLive_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "TikTokSellerSignal" (
    "username" TEXT NOT NULL,
    "videoSelling" BOOLEAN,
    "videoKeywords" TEXT NOT NULL DEFAULT '[]',
    "videoCheckedAt" TIMESTAMP(3),
    "chatSelling" BOOLEAN,
    "chatRoomId" TEXT,
    "chatHits" INTEGER NOT NULL DEFAULT 0,
    "chatCheckedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokSellerSignal_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "discountPercent" INTEGER DEFAULT 0,
    "categoryId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 4.7,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "images" TEXT NOT NULL,
    "tags" TEXT,
    "specifications" TEXT,
    "color" TEXT,
    "material" TEXT,
    "warranty" TEXT DEFAULT '7 días',
    "hasInvoice" BOOLEAN NOT NULL DEFAULT true,
    "isFlashSale" BOOLEAN NOT NULL DEFAULT false,
    "flashSaleEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "condition" TEXT NOT NULL DEFAULT 'NUEVO',
    "audience" TEXT,
    "bulky" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOffer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 10,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedDelivery" TEXT NOT NULL DEFAULT 'Llega mañana',
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "salePrice" DOUBLE PRECISION,
    "discountPercent" INTEGER DEFAULT 0,
    "isFlashSale" BOOLEAN NOT NULL DEFAULT false,
    "flashSaleEnd" TIMESTAMP(3),
    "promoBadge" TEXT,
    "promoStock" INTEGER,
    "promoSalesCount" INTEGER NOT NULL DEFAULT 0,
    "variantAxis" TEXT,
    "variants" TEXT,
    "stockCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveStream" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "streamerName" TEXT NOT NULL,
    "streamerAvatar" TEXT NOT NULL,
    "viewerCount" INTEGER NOT NULL DEFAULT 1200,
    "likeCount" INTEGER NOT NULL DEFAULT 4500,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "streamVideoUrl" TEXT,
    "tiktokUrl" TEXT,
    "featuredProductIds" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL,
    "customerLat" DOUBLE PRECISION NOT NULL DEFAULT -17.7785,
    "customerLng" DOUBLE PRECISION NOT NULL DEFAULT -63.1812,
    "paymentMethod" TEXT NOT NULL DEFAULT 'QR_SIMPLE',
    "paymentStatus" TEXT NOT NULL DEFAULT 'PAID',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "shippingFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "dspQuoteId" TEXT,
    "dspOrderId" TEXT,
    "dspTrackingToken" TEXT,
    "dspDriverName" TEXT DEFAULT 'Carlos Mendoza',
    "dspDriverPhone" TEXT DEFAULT '+591 77012345',
    "dspDriverRating" DOUBLE PRECISION DEFAULT 4.9,
    "dspDriverPhoto" TEXT,
    "dspEstimatedMinutes" INTEGER DEFAULT 20,
    "platformCommission" DOUBLE PRECISION DEFAULT 0,
    "vendorEarnings" DOUBLE PRECISION DEFAULT 0,
    "storeId" TEXT,
    "customerReference" TEXT,
    "deliveryAt" TIMESTAMP(3),
    "deliveryWindow" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productOfferId" TEXT,
    "storeId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variant" TEXT,
    "storeName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "productImage" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cashierName" TEXT NOT NULL,
    "initialCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualCash" DOUBLE PRECISION,
    "difference" DOUBLE PRECISION,
    "totalSalesCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSalesQr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSalesCard" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalExpenses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentConfig" (
    "id" TEXT NOT NULL,
    "gatewayKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "platformCommission" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "minAmount" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "maxAmount" DOUBLE PRECISION DEFAULT 5000.0,
    "apiEndpoint" TEXT,
    "apiKeyEncrypted" TEXT,
    "merchantAccountId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "storeId" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
    "discountValue" DOUBLE PRECISION NOT NULL,
    "minOrderAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDiscount" DOUBLE PRECISION,
    "usageLimit" INTEGER DEFAULT 100,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAccount" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storeId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokAccount_storeId_key" ON "TikTokAccount"("storeId");

-- CreateIndex
CREATE INDEX "TikTokLive_status_isSelling_countryCode_verifiedAt_idx" ON "TikTokLive"("status", "isSelling", "countryCode", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOffer_productId_storeId_key" ON "ProductOffer"("productId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_deliveryAt_idx" ON "Order"("status", "deliveryAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfig_gatewayKey_key" ON "PaymentConfig"("gatewayKey");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_username_key" ON "AdminAccount"("username");

-- CreateIndex
CREATE INDEX "OtpCode_phone_createdAt_idx" ON "OtpCode"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_storeId_kind_idx" ON "Payout"("storeId", "kind");

-- AddForeignKey
ALTER TABLE "TikTokAccount" ADD CONSTRAINT "TikTokAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TikTokLive" ADD CONSTRAINT "TikTokLive_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productOfferId_fkey" FOREIGN KEY ("productOfferId") REFERENCES "ProductOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

