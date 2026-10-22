-- ═══════════════════════════════════════════════════════════════════════════════
-- 0001_init — struktur dasar
-- ═══════════════════════════════════════════════════════════════════════════════
-- CATATAN PENTING
--   File ini setara dengan output `prisma migrate dev --name init`. Secara
--   struktur sudah diperiksa oleh apps/api/scripts/check-schema.ts, tapi
--   pemeriksaan itu bukan `prisma validate`.
--
--   SEBELUM DEPLOY PERTAMA KALI, jalankan di database kosong:
--       pnpm --filter @warung/api exec prisma migrate dev --name init_check
--   lalu bandingkan dengan file ini, atau lebih aman: hapus folder migration
--   ini dan generate ulang, lalu pertahankan migration `0002_domain_rules`.
--
--   Konvensi nama kolom: camelCase ter-quote (default Prisma). Sengaja tidak
--   memakai @map pada setiap kolom: menambah ~250 anotasi @map membuka peluang
--   salah ketik pada mapping, sementara camelCase bekerja perfectly di Postgres.
--   Nama TABEL memakai snake_case lewat @map, karena itu yang ditulis manusia
--   saat query manual dan saat membaca EXPLAIN.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CASHIER');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'QRIS', 'DEBT');
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'UNPAID', 'PARTIAL', 'WRITTEN_OFF');
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'VOIDED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_WA', 'WA_SENT', 'CONFIRMED', 'CONVERTED', 'CANCELLED');
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPNAME', 'DAMAGE', 'EXPIRED');
CREATE TYPE "UnitOfMeasure" AS ENUM ('PCS', 'PACK', 'KG', 'GRAM', 'LITER', 'ML', 'BOX', 'DOSE', 'RID');
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'BLOCKED');
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "CategoryColor" AS ENUM ('DEFAULT', 'RED', 'ORANGE', 'AMBER', 'GREEN', 'TEAL', 'BLUE', 'INDIGO', 'PURPLE', 'PINK');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'REFRESH', 'VOID', 'STOCK_ADJUST', 'STOCK_OPNAME', 'DEBT_PAYMENT', 'DEBT_WRITEOFF', 'ORDER_STATUS', 'EXPORT', 'BULK_IMPORT');
CREATE TYPE "StockReferenceType" AS ENUM ('TRANSACTION', 'ORDER', 'OPNAME', 'MANUAL', 'PURCHASE');

-- ─── users ────────────────────────────────────────────────────────────────────

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "role" "UserRole" NOT NULL DEFAULT 'CASHIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE INDEX "users_role_isActive_idx" ON "users"("role", "isActive");

-- ─── refresh_tokens ───────────────────────────────────────────────────────────

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(64),
    "usedAt" TIMESTAMP(3),
    "userAgent" VARCHAR(255),
    "ipAddress" VARCHAR(45),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- ─── settings ─────────────────────────────────────────────────────────────────

CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "storeName" VARCHAR(120) NOT NULL,
    "storeTagline" VARCHAR(160),
    "waPhoneNumber" VARCHAR(20) NOT NULL,
    "address" VARCHAR(500),
    "taxBps" INTEGER NOT NULL DEFAULT 1100,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
    "taxLabel" VARCHAR(32) NOT NULL DEFAULT 'PPN',
    "enableCashRounding" BOOLEAN NOT NULL DEFAULT false,
    "cashRoundingStepSen" INTEGER NOT NULL DEFAULT 10000,
    "receiptFooter" VARCHAR(500),
    "showWholesaleInCatalog" BOOLEAN NOT NULL DEFAULT false,
    "maxTransactionDiscountBps" INTEGER NOT NULL DEFAULT 3000,
    "invoicePrefix" VARCHAR(8) NOT NULL DEFAULT 'INV',
    "currency" CHAR(3) NOT NULL DEFAULT 'IDR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- ─── categories ───────────────────────────────────────────────────────────────

CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "parentId" UUID,
    "color" "CategoryColor" NOT NULL DEFAULT 'DEFAULT',
    "imageUrl" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_parentId_sortOrder_idx" ON "categories"("parentId", "sortOrder");
CREATE INDEX "categories_isActive_sortOrder_idx" ON "categories"("isActive", "sortOrder");

-- ─── products ─────────────────────────────────────────────────────────────────

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(13),
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "categoryId" UUID,
    "priceBuy" DECIMAL(14,2) NOT NULL,
    "priceSell" DECIMAL(14,2) NOT NULL,
    "priceWholesale" DECIMAL(14,2),
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'PCS',
    "imageUrl" VARCHAR(500),
    "wholesaleMinQty" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_categoryId_isActive_idx" ON "products"("categoryId", "isActive");
CREATE INDEX "products_isPublic_isActive_isFeatured_idx" ON "products"("isPublic", "isActive", "isFeatured");
CREATE INDEX "products_name_idx" ON "products"("name");
CREATE INDEX "products_stockQty_idx" ON "products"("stockQty");

-- ─── stock_movements ──────────────────────────────────────────────────────────

CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "refType" "StockReferenceType",
    "refId" UUID,
    "notes" VARCHAR(500),
    "unitCost" DECIMAL(14,2),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");
CREATE INDEX "stock_movements_refType_refId_idx" ON "stock_movements"("refType", "refId");

-- ─── customers ────────────────────────────────────────────────────────────────

CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "address" VARCHAR(500),
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");
CREATE INDEX "customers_status_name_idx" ON "customers"("status", "name");
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- ─── shifts ───────────────────────────────────────────────────────────────────

CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "closedById" UUID,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openingFloat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "countedCash" DECIMAL(14,2),
    "expectedCash" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "note" VARCHAR(500),
    "closeNote" VARCHAR(500),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shifts_openedById_status_idx" ON "shifts"("openedById", "status");
CREATE INDEX "shifts_status_idx" ON "shifts"("status");

-- ─── transactions ─────────────────────────────────────────────────────────────

CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "invoiceNo" VARCHAR(24) NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "cashierId" UUID NOT NULL,
    "customerId" UUID,
    "shiftId" UUID,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "lineDiscountTotal" DECIMAL(14,2) NOT NULL,
    "transactionDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableBase" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "roundedTotal" DECIMAL(14,2) NOT NULL,
    "roundingAdjustment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "changeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transactionDiscountBps" INTEGER NOT NULL DEFAULT 0,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
    "dueDate" TIMESTAMP(3),
    "note" VARCHAR(500),
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transactions_invoiceNo_key" ON "transactions"("invoiceNo");
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");
CREATE INDEX "transactions_transactionDate_idx" ON "transactions"("transactionDate");
CREATE INDEX "transactions_customerId_transactionDate_idx" ON "transactions"("customerId", "transactionDate");
CREATE INDEX "transactions_paymentStatus_dueDate_idx" ON "transactions"("paymentStatus", "dueDate");
CREATE INDEX "transactions_invoiceNo_idx" ON "transactions"("invoiceNo");

-- ─── transaction_items ────────────────────────────────────────────────────────

CREATE TABLE "transaction_items" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "lineDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transactionDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "lineDiscountBps" INTEGER NOT NULL DEFAULT 0,
    "costPriceSnapshot" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transaction_items_transactionId_idx" ON "transaction_items"("transactionId");
CREATE INDEX "transaction_items_productId_idx" ON "transaction_items"("productId");
CREATE INDEX "transaction_items_productId_createdAt_idx" ON "transaction_items"("productId", "createdAt");

-- ─── transaction_payments ─────────────────────────────────────────────────────

CREATE TABLE "transaction_payments" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" VARCHAR(120),
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transaction_payments_transactionId_idx" ON "transaction_payments"("transactionId");
CREATE INDEX "transaction_payments_method_paidAt_idx" ON "transaction_payments"("method", "paidAt");

-- ─── debt_payments ────────────────────────────────────────────────────────────

CREATE TABLE "debt_payments" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(120),
    "receivedById" UUID,
    "note" VARCHAR(500),
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionId" UUID,

    CONSTRAINT "debt_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "debt_payments_transactionId_key" ON "debt_payments"("transactionId");
CREATE INDEX "debt_payments_customerId_paidAt_idx" ON "debt_payments"("customerId", "paidAt");
CREATE INDEX "debt_payments_paidAt_idx" ON "debt_payments"("paidAt");

-- ─── payment_allocations ──────────────────────────────────────────────────────

CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_allocations_paymentId_transactionId_key" ON "payment_allocations"("paymentId", "transactionId");
CREATE INDEX "payment_allocations_transactionId_idx" ON "payment_allocations"("transactionId");

-- ─── debt_write_offs ──────────────────────────────────────────────────────────

CREATE TABLE "debt_write_offs" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "transactionIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "writtenOffById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_write_offs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "debt_write_offs_customerId_createdAt_idx" ON "debt_write_offs"("customerId", "createdAt");

-- ─── orders ───────────────────────────────────────────────────────────────────

CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "orderNo" VARCHAR(24) NOT NULL,
    "customerId" UUID,
    "customerName" VARCHAR(120) NOT NULL,
    "customerPhone" VARCHAR(20) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_WA',
    "note" VARCHAR(500),
    "adminNote" VARCHAR(500),
    "waMessage" TEXT,
    "waUrl" VARCHAR(600),
    "waChannel" VARCHAR(20),
    "waSentAt" TIMESTAMP(3),
    "waMessageId" VARCHAR(120),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" VARCHAR(300),
    "transactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");
CREATE UNIQUE INDEX "orders_transactionId_key" ON "orders"("transactionId");
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");
CREATE INDEX "orders_customerPhone_idx" ON "orders"("customerPhone");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- ─── order_items ──────────────────────────────────────────────────────────────

CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "stockAtOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- ─── idempotency_keys ─────────────────────────────────────────────────────────

CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "userId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- ─── document_sequences ───────────────────────────────────────────────────────

CREATE TABLE "document_sequences" (
    "prefix" CHAR(3) NOT NULL,
    "period" CHAR(7) NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("prefix", "period")
);

-- ─── audit_logs ───────────────────────────────────────────────────────────────

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" "AuditAction" NOT NULL,
    "entity" VARCHAR(60) NOT NULL,
    "entityId" VARCHAR(60),
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(255),
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_entity_entityId_createdAt_idx" ON "audit_logs"("entity", "entityId", "createdAt");
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- ─── app_state ────────────────────────────────────────────────────────────────

CREATE TABLE "app_state" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_state_pkey" PRIMARY KEY ("key")
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cashierId_fkey"
  FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "debt_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "debt_write_offs" ADD CONSTRAINT "debt_write_offs_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "debt_write_offs" ADD CONSTRAINT "debt_write_offs_writtenOffById_fkey"
  FOREIGN KEY ("writtenOffById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
