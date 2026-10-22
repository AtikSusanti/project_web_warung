-- ═══════════════════════════════════════════════════════════════════════════════
-- 0002_domain_rules — invarian yang TIDAK bisa dinyatakan di Prisma schema
-- ═══════════════════════════════════════════════════════════════════════════════
-- Prisma tidak punya CHECK constraint, partial index, trigger, full-text index,
-- maupun stored function. Aturan bisnis yang paling mahal dampaknya kalau lolos
-- (uang negatif, nomor dokumen bentrok, stok meleset, satu kasir buka dua shift)
-- justru aturan yang paling perlu dijaga oleh database, bukan oleh kode aplikasi.
--
-- Prisma tidak memvalidasi file ini, jadi perubahan harus lewat migration baru.
-- Prisma tidak begitu pun memblokir hand-edit, tapi untuk iterasi yang aman:
--   prisma migrate dev --create-only  →  edit  →  prisma migrate dev
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. updatedAt otomatis
-- ═══════════════════════════════════════════════════════════════════════════════
-- Prisma membiarkan @updatedAt diisi dari sisi aplikasi, jadi setiap UPDATE dari
-- raw SQL (psql, reporting, trigger) bisa meninggalkan timestamp basi. Trigger
-- membuat updatedAt benar siapa pun yang menulis.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_set_updated_at" BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "categories_set_updated_at" BEFORE UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "customers_set_updated_at" BEFORE UPDATE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "users_set_updated_at" BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "settings_set_updated_at" BEFORE UPDATE ON "settings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "transactions_set_updated_at" BEFORE UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "orders_set_updated_at" BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "app_state_set_updated_at" BEFORE UPDATE ON "app_state"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Nomor dokumen tanpa race condition
-- ═══════════════════════════════════════════════════════════════════════════════
-- Naif: SELECT lastValue → +1 → UPDATE. Dua kasir bisa membuka shift di detik yang sama,
-- nomor sama. INSERT ... ON CONFLICT DO UPDATE mengunci baris itu, jadi
-- counter-nya atomik tanpa perlu advisory lock di sisi aplikasi.
--
-- Sisa race: dua proses boleh mendapat angka BERBEDA (aman), tapi tidak boleh
-- dapat angka SAMA. Kombinasi ini memenuhi dua syarat itu.

CREATE OR REPLACE FUNCTION next_document_value(
  p_prefix CHAR(3),
  p_period CHAR(7),
  p_count INTEGER DEFAULT 1
) RETURNS INTEGER AS $$
DECLARE
  v_next INTEGER;
BEGIN
  IF p_count < 1 THEN
    RAISE EXCEPTION 'p_count harus >= 1, dapat %', p_count;
  END IF;

  INSERT INTO "document_sequences" AS ds ("prefix", "period", "lastValue", "updatedAt")
  VALUES (p_prefix, p_period, p_count, now())
  ON CONFLICT ("prefix", "period") DO UPDATE
    SET "lastValue" = ds."lastValue" + p_count,
        "updatedAt" = now()
  RETURNING "lastValue" INTO v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION next_document_value IS
  'Alokasikan p_count nomor dokumen berikutnya. Atomik per (prefix, period).';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. CHECK constraint — uang
-- ═══════════════════════════════════════════════════════════════════════════════
-- Kolom uang non-nullable tetap bisa berisi angka negatif lewat bug kalkulasi
-- atau input mentah. Negatif di sini berarti laporan laba rugi dan piutang
-- pelanggan langsung salah, jadi tolak di level database.

ALTER TABLE "products" ADD CONSTRAINT "products_priceBuy_nonneg"   CHECK ("priceBuy" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_priceSell_nonneg"  CHECK ("priceSell" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_priceWholesale_nonneg" CHECK ("priceWholesale" IS NULL OR "priceWholesale" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_wholesale_under_sell"  CHECK ("priceWholesale" IS NULL OR "priceWholesale" <= "priceSell");

ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton"  CHECK ("id" = 1);
ALTER TABLE "settings" ADD CONSTRAINT "settings_taxBps_range" CHECK ("taxBps" >= 0 AND "taxBps" <= 10000);
ALTER TABLE "settings" ADD CONSTRAINT "settings_max_discount_range" CHECK ("maxTransactionDiscountBps" >= 0 AND "maxTransactionDiscountBps" <= 10000);
ALTER TABLE "settings" ADD CONSTRAINT "settings_rounding_step_positive" CHECK ("cashRoundingStepSen" > 0);

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_subtotal_nonneg"  CHECK ("subtotal" >= 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_discount_nonneg"  CHECK ("discountTotal" >= 0 AND "transactionDiscountAmount" >= 0 AND "lineDiscountTotal" >= 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tax_nonneg"  CHECK ("taxTotal" >= 0 AND "taxableBase" >= 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_grand_nonneg"  CHECK ("grandTotal" >= 0 AND "roundedTotal" >= 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_paid_nonneg"  CHECK ("paidTotal" >= 0 AND "outstandingAmount" >= 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_discount_bps_range" CHECK ("transactionDiscountBps" >= 0 AND "transactionDiscountBps" <= 10000);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tax_bps_range" CHECK ("taxBps" >= 0 AND "taxBps" <= 10000);

-- roundedTotal harus sama dengan grandTotal + pembulatan. Tanpa ini, cash
-- rounding bisaGeledor jadi sumber kebenaran kedua untuk total tagihan.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_rounding_consistent"
  CHECK ("roundedTotal" = "grandTotal" + "roundingAdjustment");

-- Sisa tagihan tidak mungkin melebihi total yang harus dibayar.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_outstanding_bounded"
  CHECK ("outstandingAmount" <= "roundedTotal");

-- Transaksi lunas tidak boleh punya sisa tagihan; belum lunas wajib punya.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_status_consistent"
  CHECK (
    ("paymentStatus" = 'PAID'      AND "outstandingAmount" = 0)
    OR ("paymentStatus" = 'UNPAID'    AND "outstandingAmount" >  0)
    OR ("paymentStatus" = 'PARTIAL'   AND "outstandingAmount" >  0)
    OR ("paymentStatus" = 'WRITTEN_OFF' AND "outstandingAmount" = 0)
  );

ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_amounts_nonneg"  CHECK ("unitPrice" >= 0 AND "grossAmount" >= 0);
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_discount_nonneg" CHECK ("lineDiscountAmount" >= 0 AND "transactionDiscountAmount" >= 0 AND "discountAmount" >= 0);
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_tax_nonneg" CHECK ("taxAmount" >= 0);
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_line_discount_bps_range" CHECK ("lineDiscountBps" >= 0 AND "lineDiscountBps" <= 10000);

ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_non_cash_needs_reference"
  CHECK ("method" = 'CASH' OR "reference" IS NOT NULL);

ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_non_cash_needs_reference"
  CHECK ("method" = 'CASH' OR "reference" IS NOT NULL);

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "debt_write_offs" ADD CONSTRAINT "debt_write_offs_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "customers" ADD CONSTRAINT "customers_credit_limit_nonneg" CHECK ("creditLimit" >= 0);

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opening_float_nonneg" CHECK ("openingFloat" >= 0);
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_close_consistent"
  CHECK (
    ("status" = 'OPEN'  AND "closedAt" IS NULL     AND "countedCash" IS NULL)
    OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "countedCash" IS NOT NULL AND "expectedCash" IS NOT NULL AND "difference" IS NOT NULL)
  );

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonneg" CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "total" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_consistent" CHECK ("total" = "subtotal" - "discountTotal");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_nonneg" CHECK ("unitPrice" >= 0 AND "total" >= 0);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. CHECK constraint — stok
-- ═══════════════════════════════════════════════════════════════════════════════
-- qty pada stock_movements adalah delta bertanda: + untuk masuk, - untuk keluar.
-- stockAfter wajib = stockBefore + qty. Kalau meleset, artinya pembacaan stok
-- sebelum dan sesudah tidak terjadi dalam satu transaksi yang sama, dan jejak
-- auditnya sudah tidak dipercaya.

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qty_nonzero" CHECK ("qty" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_arithmetic" CHECK ("stockAfter" = "stockBefore" + "qty");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_nonneg_stock" CHECK ("stockBefore" >= 0 AND "stockAfter" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_cost_nonneg" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);

ALTER TABLE "products" ADD CONSTRAINT "products_stock_nonneg" CHECK ("stockQty" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_min_stock_nonneg" CHECK ("minStock" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_wholesale_qty_positive" CHECK ("wholesaleMinQty" IS NULL OR "wholesaleMinQty" > 0);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Partial index
-- ═══════════════════════════════════════════════════════════════════════════════
-- Prisma hanya bisa @@index penuh. Sebagian besar baris di tabel ini tidak
-- pernah dibaca oleh query yang paling sering dijalankan, jadi index penuh hanya menambah
-- write amplification.

-- Kasir tidak boleh punya dua shift OPEN. Aturan ini di aplikasi saja akan
-- gagal saat dua kasir menekan "buka shift" pada milidetik yang sama.
CREATE UNIQUE INDEX "shifts_one_open_per_user"
  ON "shifts"("openedById") WHERE "status" = 'OPEN';

-- Halaman daftar piutang hanya pernah membaca yang belum lunas.
CREATE INDEX "transactions_open_debts"
  ON "transactions"("customerId", "transactionDate")
  WHERE "paymentStatus" IN ('UNPAID', 'PARTIAL') AND "status" = 'COMPLETED';

-- Rekap shift: transaksi yang sudah dibatalkan tidak masuk.
CREATE INDEX "transactions_shift_sales"
  ON "transactions"("shiftId", "paymentStatus") WHERE "status" = 'COMPLETED';

-- Laporan penjualan harian: hanya yang selesai.
CREATE INDEX "transactions_completed_by_date"
  ON "transactions"("transactionDate") WHERE "status" = 'COMPLETED';

-- Katalog publik: soft-deleted dan tidak publik tidak perlu di-index penuh.
CREATE INDEX "products_public_catalog"
  ON "products"("categoryId", "name") WHERE "isActive" = true AND "isPublic" = true AND "deletedAt" IS NULL;

-- Laporan stok menipis.
CREATE INDEX "products_low_stock"
  ON "products"("stockQty") WHERE "isActive" = true AND "deletedAt" IS NULL;

-- Order yang masih hidup (belum confirm/convert/cancel).
CREATE INDEX "orders_active_pipeline"
  ON "orders"("createdAt") WHERE "status" IN ('PENDING_WA', 'WA_SENT', 'CONFIRMED');

-- Idempotency key yang masih hidup; baris expired di-purge oleh cron.
CREATE INDEX "idempotency_keys_live"
  ON "idempotency_keys"("expiresAt");

-- Token refresh yang belum dicabut. Setelah logout, token dicabut lalu
-- dikecualikan dari index ini sehingga tidak menambah write cost.
CREATE INDEX "refresh_tokens_active"
  ON "refresh_tokens"("userId", "expiresAt") WHERE "revokedAt" IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Full-text search produk
-- ═══════════════════════════════════════════════════════════════════════════════
-- Query: SELECT ... WHERE searchVector @@ plainto_tsquery('indonesian', $1)
-- GIN memberi index yang dipakai untuk `@@ tsquery`, dan 'simple' dipilih
-- karena bahasa Indonesia tidak punya konfigurasi stemming bawaan di Postgres
-- (postgresql.conf bagian dictionary tidak punya konfigurasi 'indonesian').

-- KOLOM INI SENGAJA BUKAN `GENERATED ALWAYS AS ... STORED`
--
-- Generated column terlihat rapi, tapi Prisma tidak bisa merepresentasikannya.
-- Prisma akan menghitung kolom itu sebagai DRIFT dan mengusulkan DROP COLUMN,
-- yang justru menghapus kemampuan pencarian. Trigger pada kolom biasa yang nullable,
-- memberi hasil identik dan tidak memicu drift, selama kolomnya tetap
-- dideklarasikan di schema.prisma sebagai `Unsupported("tsvector")?`.
--
-- Urutan setweight menentukan relevansi: nama & SKU paling penting, lalu
-- barcode, lalu deskripsi yang biasanya cuma kata umum.
ALTER TABLE "products" ADD COLUMN "searchVector" tsvector;

CREATE FUNCTION products_refresh_search_vector() RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" :=
      setweight(to_tsvector('simple', coalesce(NEW."name", '')), 'A')
    || setweight(to_tsvector('simple', coalesce(NEW."sku", '')), 'A')
    || setweight(to_tsvector('simple', coalesce(NEW."barcode", '')), 'B')
    || setweight(to_tsvector('simple', coalesce(NEW."description", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_search_vector_refresh"
  BEFORE INSERT OR UPDATE OF "name", "sku", "barcode", "description" ON "products"
  FOR EACH ROW EXECUTE FUNCTION products_refresh_search_vector();

CREATE INDEX "products_searchVector_idx" ON "products" USING GIN ("searchVector");

-- Pencarian produk via Prisma Client:
--   const products = await prisma.product.findMany({
--     where: {
--       searchVector: {
--         has: tsQuery,
--       },
--     },
--   });
--
-- `simple` dipilih, bukan 'indonesian': konfigurasi stemming bahasa Indonesia
-- tidak tersedia di stock PostgreSQL, jadi menyebutnya akan gagal saat migrate.
-- Konsekuensinya ini substring match, bukan stemming. Untuk "mie" tidak akan
-- menemukan "MIE_GORENG" seperti yang dilakukan stemmer, dan itu harga yang
-- masuk akal untuk katalog sebuah warung. Prefix search (to_tsquery dengan
-- `:*`) menutup sebagian celah itu.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. Audit trail untuk perubahan uang
-- ═══════════════════════════════════════════════════════════════════════════════
-- Void transaksi dan penyesuaian stok adalah operasi yang paling sering
-- dicurigai saat rekonsiliasi. Wajib ada jejak yang menyebut siapa dan kapan,
-- bukan hanya nilai akhirnya.
--
-- Disediakan sebagai fungsi, dipanggil dari service layer (bukan trigger),
-- supaya penulisan audit_log tetap satu transaction dengan perubahan yang
-- diaudit.

CREATE OR REPLACE FUNCTION write_audit(
  p_userId UUID,
  p_action "AuditAction",
  p_entity TEXT,
  p_entityId TEXT,
  p_oldValue JSONB,
  p_newValue JSONB,
  p_requestId TEXT
) RETURNS UUID AS $$
DECLARE
  v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO "audit_logs"
    ("id", "userId", "action", "entity", "entityId", "oldValue", "newValue", "requestId", "createdAt")
  VALUES
    (v_id, p_userId, p_action, p_entity, p_entityId, p_oldValue, p_newValue, p_requestId, now());
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;