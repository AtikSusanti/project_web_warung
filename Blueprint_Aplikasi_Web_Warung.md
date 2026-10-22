# BLUEPRINT APLIKASI WEB WARUNG

**Enterprise Architecture Document**

| | |
|---|---|
| **Nama** | *(disamarkan untuk publikasi)* |
| **NIM** | *(disamarkan untuk publikasi)* |
| **Versi** | 1.0 |
| **Jenis Aplikasi** | PWA (Progressive Web App) - Mobile First |
| **Domain** | Retail / Warung / POS (Point of Sale) |

## Daftar Isi

1. Executive Summary
2. Business Context & Requirement Analysis
3. Technology Stack
4. High Level Architecture
5. Modul & Functional Decomposition
6. Data Architecture (ERD)
7. UML Diagrams
8. API Design
9. PWA Strategy
10. Security & Compliance
11. Deployment & DevOps
12. Roadmap & Estimasi

---

## 1. Executive Summary

Aplikasi ini dirancang sebagai sistem POS + E-Commerce hybrid untuk warung/toko kelontong skala kecil-menengah dengan fitur unggulan:

- **Omnichannel:** pelanggan bisa lihat produk online, checkout via WhatsApp
- **POS Internal:** kasir mencatat transaksi dengan kalkulasi otomatis
- **Credit Management:** pencatatan utang/piutang (kasbon) pelanggan
- **Accounting-Grade Reporting:** laporan sesuai standar akuntansi (SAK EMKM)
- **PWA Mobile-First:** installable, offline-capable, hemat bandwidth

### Target User

| Role | Deskripsi |
|---|---|
| Admin/Owner | Pemilik warung, kelola master data & lihat laporan |
| Kasir | Owner yang melayani transaksi langsung |
| Pelanggan | End-user yang melihat katalog & order via WA |

---

## 2. Business Context

### 2.1 Business Goals

- Digitalisasi warung tradisional
- Mengurangi human error dalam pencatatan utang
- Menyediakan laporan keuangan real-time
- Mempermudah pelanggan order tanpa antri

### 2.2 Functional Requirements Mapping

| # | Requirement | Modul | Prioritas |
|---|---|---|---|
| 1 | Admin kelola barang, harga, kategori, stok | Product Management | P0 |
| 2 | Pelanggan lihat katalog & harga | Public Catalog | P0 |
| 3 | Checkout via WhatsApp | Order & WA Integration | P0 |
| 4 | Kasir catat transaksi + auto kalkulasi | POS / Cashier | P0 |
| 5 | Catat utang & pembayaran | Credit/Receivable | P0 |
| 6 | Laporan keuangan SAK EMKM | Reporting & Accounting | P0 |

### 2.3 Non-Functional Requirements

- **Performance:** TTFB < 500ms, LCP < 2.5s
- **Availability:** 99.5% uptime
- **Scalability:** 100 concurrent users (single warung), multi-tenant ready
- **Security:** OWASP Top 10 compliance, JWT + refresh token
- **Offline:** PWA service worker untuk mode offline kasir
- **Audit:** Semua transaksi immutable (append-only ledger)

---

## 3. Technology Stack

### 3.1 Frontend

| Layer | Teknologi | Alasan |
|---|---|---|
| Framework | Next.js 14 (App Router) | SSR/SSG untuk SEO katalog, RSC untuk performa |
| Language | TypeScript 5 | Type safety, maintainability |
| UI Library | shadcn/ui + Tailwind CSS | Headless, customizable, ringan |
| State Management | Zustand + TanStack Query | Server state vs client state terpisah |
| PWA | next-pwa / Workbox | Service worker, offline cache |
| Form | React Hook Form + Zod | Validasi schema |
| Charts | Recharts | Laporan keuangan |
| PDF Export | jsPDF + AutoTable | Export laporan |

### 3.2 Backend

| Layer | Teknologi | Alasan |
|---|---|---|
| Runtime | Node.js 20 LTS | Ekosistem matang |
| Framework | NestJS 10 | Modular, DI, enterprise-grade |
| ORM | Prisma | Type-safe, migration friendly |
| Database | PostgreSQL 16 | ACID, JSON support, reliable |
| Cache | Redis 7 | Session, rate limit, cache katalog |
| Queue | BullMQ | Background job (WA notification) |
| Auth | JWT + Refresh Token (Passport) | Stateless, scalable |
| File Storage | MinIO / Cloudflare R2 | Gambar produk |
| Validation | class-validator + Zod | DTO validation |

### 3.3 Integration

| Service | Provider | Fungsi |
|---|---|---|
| WhatsApp | wa.me deep link (free) → upgrade WhatsApp Business Cloud API | Kirim order |
| Payment (opsional) | Midtrans / Xendit | QRIS, VA |
| Email | Resend | Notifikasi laporan |
| Monitoring | Sentry + Grafana | Error & metrics |
| Analytics | Umami (self-hosted) | Privacy-friendly |

### 3.4 DevOps

| Layer | Teknologi |
|---|---|
| Container | Docker + Docker Compose |
| Orchestration | Docker Swarm (SMB) / K8s (enterprise) |
| CI/CD | GitHub Actions |
| Reverse Proxy | Nginx / Traefik |
| Hosting | VPS (Biznet/IDCloudHost) atau Vercel + Railway |
| Backup | pg_dump cron → S3-compatible |

### 3.5 Arsitektur Pattern

- Clean Architecture (Domain → Use Case → Adapter → Infra)
- CQRS-lite untuk laporan (read replica / materialized view)
- Event-driven untuk notifikasi (BullMQ)
- Multi-tenant via `tenant_id` row-level security

---

## 4. High Level Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                       CLIENT LAYER (PWA)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Pelanggan   │  │    Kasir     │  │     Admin/Owner      │   │
│  │ (Public PWA) │  │  (POS PWA)   │  │   (Dashboard PWA)    │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
└─────────┼─────────────────┼─────────────────────┼───────────────┘
          │                 │                     │
          └─────────────────┼─────────────────────┘
                            │ HTTPS / REST / JWT
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EDGE / API GATEWAY                         │
│        Nginx / Traefik → Rate Limit → CORS → Load Balance       │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                  APPLICATION LAYER (NestJS)                     │
│  ┌────────────┬────────────┬────────────┬────────────────────┐  │
│  │   Auth     │  Product   │   Order    │    POS/Cashier     │  │
│  │   Module   │  Module    │   Module   │    Module          │  │
│  ├────────────┼────────────┼────────────┼────────────────────┤  │
│  │  Credit    │  Reporting │  WhatsApp  │  User & Role       │  │
│  │  Module    │  Module    │  Gateway   │  Module            │  │
│  └────────────┴────────────┴────────────┴────────────────────┘  │
│            Shared: Prisma, Redis, BullMQ                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                          DATA LAYER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ PostgreSQL   │  │ Redis Cache  │  │   Object Storage      │  │
│  │ (Primary +   │  │ (Session,    │  │   (MinIO/R2)          │  │
│  │ Read Replica)│  │  BullMQ)     │  │                       │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                       EXTERNAL SERVICES                         │
│   WhatsApp Cloud API │ Midtrans │ Resend │ Sentry │ Umami       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Modul & Functional Decomposition

### 5.1 Modul 1 — Product Management (Admin)

**Fungsi:**

- CRUD Barang (nama, SKU, barcode)
- CRUD Kategori (hierarki)
- Manajemen Harga (harga beli, harga jual, harga grosir)
- Manajemen Stok (stok masuk, stok keluar, stok opname, minimum stok)
- Upload gambar produk
- Bulk import via CSV/Excel

**Entities:** `Product`, `Category`, `StockMovement`, `PriceHistory`

### 5.2 Modul 2 — Public Catalog (Pelanggan)

**Fungsi:**

- Katalog produk (list + grid)
- Filter kategori, search, sort by harga
- Detail produk dengan stok real-time
- Show harga publik (bisa disembunyikan untuk grosir)

**Cache Strategy:** Redis + ISR Next.js (revalidate 60s)

### 5.3 Modul 3 — WhatsApp Order

**Fungsi:**

- Cart pelanggan (localStorage + Zustand)
- Input nama, no HP, catatan
- Generate pesan format terstruktur → `wa.me/{no_warung}?text=...`
- Simpan `Order` dengan status `PENDING_WA` (audit trail)

**Format pesan:**

```text
🛒 *PESANAN BARU*
Nama: Budi
HP: 0812xxx

1. Indomie Goreng x5 = Rp 15.000
2. Telur 1kg x1 = Rp 28.000
------------------------
*TOTAL: Rp 43.000*

Catatan: Tolong dibungkus rapi
```

### 5.4 Modul 4 — POS / Kasir

**Fungsi:**

- Input transaksi (scan barcode / cari nama)
- Hitung subtotal, diskon, pajak, total
- Input bayar → auto hitung kembalian
- Multiple payment method (cash, transfer, QRIS, utang)
- Cetak struk (thermal printer via WebUSB/Bluetooth)
- Shift management (buka/tutup kasir, cash drawer)

**Kalkulasi:**

```text
subtotal   = Σ (harga_jual × qty)
diskon_amt = subtotal × (diskon_pct/100)
total      = subtotal - diskon_amt + pajak
kembalian  = bayar - total
```

### 5.5 Modul 5 — Credit / Receivable (Utang)

**Fungsi:**

- Catat transaksi dengan metode `CREDIT`
- Kartu utang per pelanggan
- Pembayaran utang (partial/full)
- Aging report (0-30, 31-60, 61-90, >90 hari)
- Reminder via WA
- Limit kredit per pelanggan

**State Machine Utang:**

```text
UNPAID → PARTIAL → PAID
   └────────┴──────────→ WRITTEN_OFF
```

### 5.6 Modul 6 — Accounting & Reporting (SAK EMKM)

**Laporan Wajib:**

1. **Laporan Laba Rugi (Income Statement)**
   - Pendapatan penjualan
   - HPP (Harga Pokok Penjualan) — metode FIFO/Average
   - Laba bruto
   - Beban operasional
   - Laba bersih
2. **Laporan Perubahan Modal**
3. **Neraca (Balance Sheet)**
   - Aset: kas, piutang, persediaan, aset tetap
   - Liabilitas: utang dagang, utang bank
   - Ekuitas: modal awal, laba ditahan
4. **Laporan Arus Kas (Cash Flow)**
5. **Catatan atas Laporan Keuangan**

**Chart of Accounts (COA) Standar:**

```text
1000 Aset
  1100 Kas
  1200 Piutang Usaha
  1300 Persediaan
2000 Liabilitas
  2100 Utang Usaha
3000 Ekuitas
  3100 Modal
4000 Pendapatan
  4100 Penjualan
5000 HPP
6000 Beban Operasional
```

**Double-Entry Bookkeeping:**

Setiap transaksi otomatis generate jurnal.

```text
Penjualan tunai Rp 50.000:
  Dr. Kas          50.000
    Cr. Penjualan          50.000
  Dr. HPP          35.000
    Cr. Persediaan         35.000
```

---

## 6. Data Architecture

### 6.1 ERD (Entity Relationship Diagram)

```text
┌─────────────┐   ┌─────────────┐   ┌──────────────┐
│   users     │   │ categories  │   │   products   │
├─────────────┤   ├─────────────┤   ├──────────────┤
│ id (PK)     │   │ id (PK)     │──┐│ id (PK)      │
│ username    │   │ name        │  ││ sku          │
│ password    │   │ parent_id   │  └<│ category_id  │
│ role        │   │ created_at  │   │ name         │
│ full_name   │   └─────────────┘   │ price_buy    │
│ phone       │                     │ price_sell   │
│ created_at  │                     │ stock        │
└──────┬──────┘                     │ min_stock    │
       │                            │ unit         │
       │                            │ image_url    │
       │                            │ is_active    │
       │                            └──────┬───────┘
       │                                   │
┌─────────────────┐   ┌──────────────────┐
│  transactions   │   │ transaction_items│
├─────────────────┤   ├──────────────────┤
│ id (PK)         │──┐│ id (PK)          │
│ invoice_no      │  ││ transaction_id   │◄─┘
│ cashier_id (FK) │  └<│ product_id (FK)  │
│ customer_id(FK) │   │ qty              │
│ subtotal        │   │ price            │
│ discount        │   │ subtotal         │
│ tax             │   │ cost_price       │
│ total           │   └──────────────────┘
│ paid_amount     │
│ change_amount   │   ┌──────────────┐
│ payment_method  │   │  customers   │
│ payment_status  │   ├──────────────┤
│ due_date        │   │ id (PK)      │
│ created_at      │   │ name         │
└────────┬────────┘   │ phone        │
         │            │ address      │
         │            │ credit_limit │
         │            │ balance_due  │
         │            └──────┬───────┘
         │                   │
┌──────────────────┐  ┌──────────────────┐
│  debt_payments   │  │     journals     │
├──────────────────┤  ├──────────────────┤
│ id (PK)          │  │ id (PK)          │
│ transaction_id   │  │ ref_type         │
│ customer_id      │  │ ref_id           │
│ amount           │  │ date             │
│ payment_date     │  │ description      │
│ method           │  └────────┬─────────┘
│ received_by      │           │
└──────────────────┘           ▼
                      ┌──────────────────┐
                      │  journal_lines   │
                      ├──────────────────┤
                      │ id (PK)          │
                      │ journal_id (FK)  │
                      │ account_id (FK)  │
                      │ debit            │
                      │ credit           │
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ accounts (COA)   │
                      ├──────────────────┤
                      │ id (PK)          │
                      │ code             │
                      │ name             │
                      │ type             │
                      │ parent_id        │
                      └──────────────────┘

┌──────────────────┐  ┌──────────────────┐
│ stock_movements  │  │      orders      │
├──────────────────┤  ├──────────────────┤
│ id (PK)          │  │ id (PK)          │
│ product_id (FK)  │  │ customer_name    │
│ type (IN/OUT/ADJ)│  │ customer_phone   │
│ qty              │  │ items (JSONB)    │
│ ref_type         │  │ total            │
│ ref_id           │  │ status           │
│ notes            │  │ wa_sent_at       │
│ created_at       │  │ created_at       │
└──────────────────┘  └──────────────────┘

┌──────────────────┐
│    audit_logs    │
├──────────────────┤
│ id (PK)          │
│ user_id          │
│ action           │
│ entity           │
│ entity_id        │
│ old_value(JSONB) │
│ new_value(JSONB) │
│ ip_address       │
│ created_at       │
└──────────────────┘
```

### 6.2 Indexing Strategy

- `products.sku` — UNIQUE
- `products.category_id, is_active` — composite
- `transactions.created_at` — B-tree (reporting)
- `transactions.payment_status, due_date` — partial index `WHERE status != 'PAID'`
- `journal_lines.account_id, journal_id` — composite
- Full-text search: `products.name` → GIN index

---

## 7. UML Diagrams

### 7.1 Use Case Diagram

```text
                    ┌───────────────────────────────────────────┐
                    │           APLIKASI WARUNG PWA             │
                    │                                           │
   ┌────────┐       │  ┌─────────────────────────────────────┐  │
   │        │───────┼─>│ (UC-01) Login                       │  │
   │ Admin  │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-02) Kelola Produk               │  │
   │        │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-03) Kelola Kategori             │  │
   │        │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-04) Kelola Stok                 │  │
   │        │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-05) Lihat Laporan Keuangan      │  │
   └────────┘       │  └─────────────────────────────────────┘  │
                    │                                           │
   ┌────────┐       │  ┌─────────────────────────────────────┐  │
   │Pelang- │───────┼─>│ (UC-06) Lihat Katalog               │  │
   │  gan   │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-07) Pilih Barang & Jumlah       │  │
   │        │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-08) Kirim Pesanan ke WhatsApp   │  │
   └────────┘       │  └─────────────────────────────────────┘  │
                    │                                           │
   ┌────────┐       │  ┌─────────────────────────────────────┐  │
   │ Kasir  │───────┼─>│ (UC-09) Buat Transaksi Penjualan    │  │
   │        │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-10) Hitung Total & Kembalian    │  │
   │        │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-11) Catat Transaksi Utang       │  │
   │        │       │  └─────────────────────────────────────┘  │
   │        │───────┼─>│ (UC-12) Terima Pembayaran Utang     │  │
   └────────┘       │  └─────────────────────────────────────┘  │
                    └───────────────────────────────────────────┘
```

### 7.2 Class Diagram (Domain Model)

```text
┌───────────────────────────────────────┐
│                 User                  │
├───────────────────────────────────────┤
│ - id: UUID                            │
│ - username: string                    │
│ - passwordHash: string                │
│ - role: UserRole                      │
│ - fullName: string                    │
├───────────────────────────────────────┤
│ + login(pwd): Token                   │
│ + hasPermission(action): boolean      │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│               Product                 │
├───────────────────────────────────────┤
│ - id: UUID                            │
│ - sku: string                         │
│ - name: string                        │
│ - categoryId: UUID                    │
│ - priceBuy: Money                     │
│ - priceSell: Money                    │
│ - stock: int                          │
│ - minStock: int                       │
├───────────────────────────────────────┤
│ + adjustStock(qty, reason): void      │
│ + isLowStock(): boolean               │
│ + calcMargin(): Money                 │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│             Transaction               │
├───────────────────────────────────────┤
│ - id: UUID                            │
│ - invoiceNo: string                   │
│ - cashierId: UUID                     │
│ - customerId: UUID?                   │
│ - items: TransactionItem[]            │
│ - subtotal: Money                     │
│ - discount: Money                     │
│ - tax: Money                          │
│ - total: Money                        │
│ - paidAmount: Money                   │
│ - changeAmount: Money                 │
│ - paymentMethod: PaymentMethod        │
│ - paymentStatus: PaymentStatus        │
├───────────────────────────────────────┤
│ + addItem(product, qty): void         │
│ + removeItem(itemId): void            │
│ + calculateTotal(): Money             │
│ + calculateChange(): Money            │
│ + finalize(): void                    │
│ + generateJournal(): Journal          │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│               Customer                │
├───────────────────────────────────────┤
│ - id: UUID                            │
│ - name: string                        │
│ - phone: string                       │
│ - creditLimit: Money                  │
│ - balanceDue: Money                   │
├───────────────────────────────────────┤
│ + canBorrow(amount): boolean          │
│ + addDebt(amount): void               │
│ + payDebt(amount): DebtPayment        │
│ + getAging(): AgingBucket             │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│                Journal                │
├───────────────────────────────────────┤
│ - id: UUID                            │
│ - refType: string                     │
│ - refId: UUID                         │
│ - date: Date                          │
│ - lines: JournalLine[]                │
├───────────────────────────────────────┤
│ + addLine(account, debit, credit)     │
│ + isBalanced(): boolean               │
│ + post(): void                        │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│                 Order                 │
├───────────────────────────────────────┤
│ - id: UUID                            │
│ - customerName: string                │
│ - customerPhone: string               │
│ - items: OrderItem[]                  │
│ - total: Money                        │
│ - status: OrderStatus                 │
├───────────────────────────────────────┤
│ + addItem(product, qty): void         │
│ + generateWAMessage(): string         │
│ + markAsSent(): void                  │
└───────────────────────────────────────┘

enum UserRole      { ADMIN, CASHIER, CUSTOMER }
enum PaymentMethod { CASH, TRANSFER, QRIS, CREDIT }
enum PaymentStatus { PAID, UNPAID, PARTIAL, WRITTEN_OFF }
enum OrderStatus   { PENDING_WA, WA_SENT, CONFIRMED, CANCELLED }
```

### 7.3 Sequence Diagram — Checkout via WhatsApp (UC-06, 07, 08)

```text
Pelanggan  PWA Catalog   API Gateway   OrderSvc   WAGateway   WA Server
   │            │             │            │           │           │
   │─Lihat─────>│             │            │           │           │
   │ katalog    │──GET /products──────────>│           │           │
   │            │<──200 JSON ──────────────│           │           │
   │<─Render────│             │            │           │           │
   │            │             │            │           │           │
   │─Tambah────>│             │            │           │           │
   │ ke cart    │ (local state)│           │           │           │
   │            │             │            │           │           │
   │─Checkout──>│             │            │           │           │
   │            │──POST /orders────────────>│          │           │
   │            │             │            │─save─────>│           │
   │            │             │            │<─ok───────│           │
   │            │<─201 {orderId, waUrl}─────│          │           │
   │<─Redirect──│             │            │           │           │
   │ ke wa.me   │             │            │           │           │
   │─────────────────────Buka WhatsApp─────────────────────────────>│
   │            │             │            │           │           │
   │─Kirim─────>│             │            │           │           │
   │ pesan      │             │            │           │           │
   │            │             │            │──update──>│           │
   │            │             │            │  status   │           │
```

### 7.4 Sequence Diagram — Transaksi POS + Kembalian (UC-09, 10)

```text
Kasir     POS PWA        API      TransactionSvc  InventorySvc  AccountingSvc
  │          │            │            │              │              │
  │─Scan────>│            │            │              │              │
  │ barcode  │──GET /product/:sku──────>│              │              │
  │          │<─200 product─────────────│              │              │
  │─Input───>│            │            │              │              │
  │ qty      │ (calc subtotal locally) │              │              │
  │          │            │            │              │              │
  │─Bayar───>│            │            │              │              │
  │ Rp100k   │──POST /transactions─────>│              │              │
  │          │ {items, paid, method}   │              │              │
  │          │            │            │─validate────>│              │
  │          │            │            │<─stock OK────│              │
  │          │            │            │              │              │
  │          │            │            │──decrement──>│              │
  │          │            │            │   stock      │              │
  │          │            │            │              │              │
  │          │            │            │──generate journal──────────>│
  │          │            │            │              │              │
  │          │            │            │  Dr. Kas                    │
  │          │            │            │  Cr. Penjualan              │
  │          │            │            │  Dr. HPP                    │
  │          │            │            │  Cr. Persediaan             │
  │          │            │            │<─journal ok─────────────────│
  │          │            │            │              │              │
  │          │<─201 {invoice, change: 15.000}─────────│              │
  │<─Struk───│            │            │              │              │
```

### 7.5 Sequence Diagram — Utang & Pembayaran (UC-11, 12)

```text
Kasir     POS PWA        API       CreditSvc   CustomerRepo  AccountingSvc
  │          │            │            │            │              │
  │─Transaksi──────────>  │            │            │              │
  │ metode=CREDIT         │──create───>│            │              │
  │          │            │            │─cek limit─>│              │
  │          │            │            │<─ok────────│              │
  │          │            │            │            │              │
  │          │            │            │──update───>│              │
  │          │            │            │ balanceDue │              │
  │          │            │            │            │              │
  │          │            │            │──journal────────────────>│
  │          │            │            │  Dr. Piutang              │
  │          │            │            │  Cr. Penjualan            │
  │          │<─201 transaksi UNPAID───│            │              │
  │          │            │            │            │              │
  │─Pelanggan bayar sebagian────────> │            │              │
  │          │──POST /debts/pay──────>│            │              │
  │          │ {custId, amount}       │            │              │
  │          │            │            │──reduce───>│              │
  │          │            │            │ balanceDue │              │
  │          │            │            │            │              │
  │          │            │            │──journal────────────────>│
  │          │            │            │  Dr. Kas                  │
  │          │            │            │  Cr. Piutang              │
  │          │<─200 paid───────────────│            │              │
```

### 7.6 State Diagram — Transaction Lifecycle

```text
                    ┌──────────┐
                    │  DRAFT   │
                    └────┬─────┘
                         │ addItems
                         ▼
                    ┌──────────┐
                    │  OPEN    │
                    └────┬─────┘
                         │ checkout
                         ▼
              ┌──────────┴──────────┐
              │                     │
      payment=CASH/QRIS      payment=CREDIT
              │                     │
              ▼                     ▼
         ┌──────────┐         ┌──────────┐
         │  PAID    │         │ UNPAID   │
         └──────────┘         └────┬─────┘
                                   │ partial payment
                                   ▼
                              ┌──────────┐
                              │ PARTIAL  │
                              └────┬─────┘
                                   │ full payment
                                   ▼
                              ┌──────────┐
                              │  PAID    │
                              └──────────┘

     (dari UNPAID/PARTIAL)
              │ write-off
              ▼
        ┌────────────┐
        │WRITTEN_OFF │
        └────────────┘
```

### 7.7 Activity Diagram — Laporan Keuangan

```text
[Mulai]
   │
   ▼
[Pilih Periode]
   │
   ▼
[Query Transaksi + Jurnal]
   │
   ▼
┌──<Ada Data?>──┐
│ Tidak         │ Ya
▼               ▼
[Tampil     [Hitung Agregat]
 Kosong]         │
│                ▼
│         ┌─<Tipe Laporan?>
│         │
│    ┌────┼────┬────────┬─────────┐
│    ▼    ▼    ▼        ▼         ▼
│  [L/R][Perub][Neraca][Arus Kas][COA]
│    │   Modal   │        │         │
│    └────┴───────┴────────┴─────────┘
│         │
│         ▼
│  [Format & Render]
│         │
│         ▼
│  ┌─<Export?>
│  │
│  ┌────┼────┐
│  ▼    ▼    ▼
│ [PDF][XLSX][Print]
│  └────┴────┘
│       │
└───────┴──> [Selesai]
```

### 7.8 Component Diagram

> Catatan: bagian ini terpotong di dokumen sumber (PDF), jadi hanya sebagian diagram yang tersedia.

```text
┌────────────────────────────────────────────────────────────────┐
│ <component> PWA Client                                         │
│ ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐    │
│ │ <component> │  │ <component> │  │ <component>           │    │
│ │ Catalog UI  │  │ POS UI      │  │ Admin Dashboard       │    │
```

---

## 8. API Design

### 8.1 API Principles

- RESTful API menggunakan JSON.
- Semua endpoint menggunakan HTTPS.
- Autentikasi menggunakan JWT dan refresh token.
- Validasi request dilakukan di sisi backend.
- Endpoint yang mengubah data wajib mencatat audit log.
- Response menggunakan HTTP status code yang konsisten.

### 8.2 Authentication

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/auth/login` | Login user |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout |

### 8.3 Product

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/products` | Daftar produk |
| GET | `/products/:id` | Detail produk |
| POST | `/products` | Tambah produk |
| PATCH | `/products/:id` | Edit produk |
| DELETE | `/products/:id` | Nonaktifkan produk |

### 8.4 Orders & WhatsApp

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/orders` | Membuat order |
| GET | `/orders/:id` | Detail order |
| PATCH | `/orders/:id/status` | Update status order |

### 8.5 Transactions

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/transactions` | Membuat transaksi |
| GET | `/transactions` | Daftar transaksi |
| GET | `/transactions/:id` | Detail transaksi |

### 8.6 Debts

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/customers/:id/debts` | Daftar utang pelanggan |
| POST | `/debts/pay` | Membayar utang |
| GET | `/debts/aging` | Aging report |

### 8.7 Reports

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/reports/income-statement` | Laporan laba rugi |
| GET | `/reports/balance-sheet` | Neraca |
| GET | `/reports/cash-flow` | Arus kas |
| GET | `/reports/equity` | Perubahan modal |
| GET | `/reports/notes` | Catatan laporan keuangan |

---

## 9. PWA Strategy

### 9.1 Installability

- Web App Manifest.
- App icon.
- Splash screen.
- Standalone display mode.
- HTTPS mandatory.

### 9.2 Caching Strategy

- Cache First untuk asset statis.
- Stale While Revalidate untuk katalog.
- Network First untuk data transaksi.
- Background Sync untuk transaksi offline.

### 9.3 Offline Mode

Kasir tetap dapat:

- Membuka halaman POS.
- Melihat produk yang telah tersimpan di cache.
- Membuat transaksi offline.
- Menyimpan transaksi pada IndexedDB.
- Sinkronisasi ketika koneksi kembali.

### 9.4 Conflict Resolution

- Server menjadi source of truth.
- Setiap transaksi memiliki UUID.
- Sync menggunakan idempotency key.
- Konflik stok ditangani melalui validasi server.
- Transaksi gagal sinkron masuk retry queue.

---

## 10. Security & Compliance

### 10.1 Authentication & Authorization

- Password di-hash menggunakan Argon2id/bcrypt.
- JWT access token berumur pendek.
- Refresh token dirotasi.
- Role-Based Access Control (RBAC).
- Session invalidation saat logout.

### 10.2 Application Security

- Input validation.
- SQL injection prevention via Prisma parameterization.
- XSS protection.
- CSRF protection.
- Rate limiting.
- CORS allowlist.
- Security headers.
- Secure cookies.

### 10.3 Data Protection

- TLS 1.2+.
- Database encryption at rest.
- Secrets disimpan di environment/secret manager.
- Backup terenkripsi.
- PII minimization.
- Audit log.

### 10.4 Compliance

- OWASP Top 10.
- Prinsip least privilege.
- Retensi data dapat dikonfigurasi.
- Audit trail untuk aktivitas penting.
- Pengelolaan data pelanggan mengikuti ketentuan perlindungan data yang berlaku.

---

## 11. Deployment & DevOps

### 11.1 Production Architecture

```text
Internet
   │
   ▼
CDN / DNS
   │
   ▼
Reverse Proxy
   │
   ├───────────────┐
   ▼               ▼
Frontend        Backend API
Next.js          NestJS
   │               │
   │        ┌──────┼─────────┐
   │        ▼      ▼         ▼
   │   PostgreSQL Redis  Object Storage
   │
   └──────────────┬───────────
                  ▼
           External Services
```

### 11.2 CI/CD Pipeline

```text
Git Push
  ↓ Lint
  ↓ Unit Test
  ↓ Build
  ↓ Integration Test
  ↓ Docker Build
  ↓ Security Scan
  ↓ Deploy Staging
  ↓ Smoke Test
  ↓ Deploy Production
  ↓ Monitoring
```

### 11.3 Backup Strategy

- Database backup harian.
- Retensi backup minimal 30 hari.
- Backup disimpan pada storage terpisah.
- Restore test dilakukan berkala.
- Point-in-time recovery dapat digunakan untuk database production.

---

## 12. Roadmap & Estimasi

### Phase 1 — MVP

**Estimasi:** 3–4 minggu

**Scope:**

- Login & role
- Product management
- Category
- Stock sederhana
- Public catalog
- Cart
- WhatsApp checkout
- POS dasar
- Transaksi cash
- Pencatatan utang dasar

### Phase 2 — Business Features

**Estimasi:** 2–3 minggu

**Scope:**

- Customer management
- Pembayaran utang
- Aging report
- QRIS/payment integration
- Receipt printing
- Dashboard
- Export laporan

### Phase 3 — Accounting

**Estimasi:** 2–3 minggu

**Scope:**

- COA
- Journal
- Double-entry
- HPP
- Laba rugi
- Neraca
- Arus kas
- Perubahan modal
- Catatan laporan keuangan

### Phase 4 — Production Hardening

**Estimasi:** 1–2 minggu

**Scope:**

- Security hardening
- Performance optimization
- Offline sync
- Monitoring
- Backup & restore
- CI/CD
- Documentation
- UAT

### Total Estimasi

**8–12 minggu** untuk versi production-ready dengan satu tim kecil.
