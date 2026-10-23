-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "winwincod_dev";

-- CreateEnum
CREATE TYPE "winwincod_dev"."transaction_type" AS ENUM ('DEPOSIT', 'ORDER_PAYMENT', 'REFUND_RETURN', 'WITHDRAWAL', 'SHIPPING_PAYMENT', 'DELIVERY_PROFIT');

-- CreateEnum
CREATE TYPE "winwincod_dev"."deposit_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "winwincod_dev"."withdrawal_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "winwincod_dev"."user_role" AS ENUM ('ADMIN', 'SELLER', 'CALL_CENTER');

-- CreateEnum
CREATE TYPE "winwincod_dev"."notification_type" AS ENUM ('ORDER_STATUS', 'DEPOSIT_APPROVED', 'DEPOSIT_REJECTED', 'PROFIT_CREDITED', 'WALLET_DEDUCTED', 'NEW_ORDER');

-- CreateEnum
CREATE TYPE "winwincod_dev"."order_status" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'WAITING_PAYMENT', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED');

-- CreateTable
CREATE TABLE "winwincod_dev"."user" (
    "id" TEXT NOT NULL,
    "seqId" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "phone" TEXT,
    "role" "winwincod_dev"."user_role" NOT NULL DEFAULT 'SELLER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "rib" TEXT,
    "city" TEXT,
    "storeName" TEXT,
    "storeDescription" TEXT,
    "storeLink" TEXT,
    "hasCompletedOnboarding" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0.0,

    CONSTRAINT "wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."transaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "type" "winwincod_dev"."transaction_type" NOT NULL,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."order" (
    "id" TEXT NOT NULL,
    "seqId" INTEGER,
    "sellerId" TEXT NOT NULL,
    "batchId" TEXT,
    "productId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "codAmount" DECIMAL(65,30) NOT NULL,
    "codReceived" DECIMAL(65,30),
    "shippingFee" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "systemFee" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "netProfit" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "status" "winwincod_dev"."order_status" NOT NULL DEFAULT 'DRAFT',
    "trackingNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."orderbatch" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "paymentProof" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orderbatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."SellerProduct" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."product" (
    "id" TEXT NOT NULL,
    "seqId" INTEGER,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "images" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "costPrice" DECIMAL(65,30) NOT NULL,
    "sellerPrice" DECIMAL(65,30) NOT NULL,
    "marketPrice" DECIMAL(65,30) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactInfo" TEXT,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."depositrequest" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "receiptImage" TEXT,
    "status" "winwincod_dev"."deposit_status" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depositrequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "winwincod_dev"."order_status" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."withdrawalrequest" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "receiptImage" TEXT,
    "status" "winwincod_dev"."withdrawal_status" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawalrequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "winwincod_dev"."notification_type" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winwincod_dev"."VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "winwincod_dev"."user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "winwincod_dev"."wallet"("userId");

-- CreateIndex
CREATE INDEX "Transaction_walletId_idx" ON "winwincod_dev"."transaction"("walletId");

-- CreateIndex
CREATE INDEX "Log_userId_idx" ON "winwincod_dev"."log"("userId");

-- CreateIndex
CREATE INDEX "Order_batchId_idx" ON "winwincod_dev"."order"("batchId");

-- CreateIndex
CREATE INDEX "Order_sellerId_idx" ON "winwincod_dev"."order"("sellerId");

-- CreateIndex
CREATE INDEX "Order_productId_idx" ON "winwincod_dev"."order"("productId");

-- CreateIndex
CREATE INDEX "OrderBatch_sellerId_idx" ON "winwincod_dev"."orderbatch"("sellerId");

-- CreateIndex
CREATE INDEX "SellerProduct_sellerId_idx" ON "winwincod_dev"."SellerProduct"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerProduct_sellerId_productId_key" ON "winwincod_dev"."SellerProduct"("sellerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "winwincod_dev"."product"("sku");

-- CreateIndex
CREATE INDEX "Product_supplierId_idx" ON "winwincod_dev"."product"("supplierId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_idx" ON "winwincod_dev"."OrderStatusHistory"("orderId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "winwincod_dev"."Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "winwincod_dev"."Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "winwincod_dev"."Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "winwincod_dev"."Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "winwincod_dev"."Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "winwincod_dev"."Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "winwincod_dev"."VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "winwincod_dev"."VerificationToken"("identifier", "token");


-- Private-schema defense in depth; no policies or grants to API roles.
REVOKE ALL ON SCHEMA "winwincod_dev" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA "winwincod_dev" FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "winwincod_dev" REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER TABLE "winwincod_dev"."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."wallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."orderbatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."SellerProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."depositrequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."OrderStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."withdrawalrequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winwincod_dev"."VerificationToken" ENABLE ROW LEVEL SECURITY;
