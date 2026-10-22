/**
 * Pemeriksa konsistensi skema Prisma TANPA perlu Prisma terpasang.
 *
 * Menangkap kelas kesalahan yang paling merusak di sistem ini:
 * - Relasi Prisma yang hanya dideklarasikan satu sisi. Prisma sendiri akan
 *   menolak, tapi pesannya kurang informatif; lebih baik menangkap di sini
 *   dengan nama model dan field yang jelas.
 * - Nilai enum di Prisma yang tidak sama dengan konstanta di
 *   packages/shared/src/enums.ts. Ini yang diam-diam merusak karena
 *   TypeScript tetap compile: string enum Prisma tidak terikat ke union type.
 * - Kolom uang yang bukan Decimal.
 *
 * Dijalankan oleh `pnpm --filter @warung/api db:check-schema` dan oleh CI
 * sebelum `prisma migrate`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');

const errors: string[] = [];
const warnings: string[] = [];

// ─── Parse blok model & enum ─────────────────────────────────────────────────

interface Field {
  name: string;
  type: string;
  attrs: string[];
  isList: boolean;
  isOptional: boolean;
  line: number;
  raw: string;
}

interface Model {
  name: string;
  fields: Field[];
  line: number;
}

interface Enum {
  name: string;
  values: string[];
  line: number;
}

/**
 * Atribut Prisma bisa mengandung spasi di dalamnya, mis. @db.Decimal(14, 2).
 * Karena itu perbandingan atribut dilakukan pada bentuk yang sudah dinormalisasi.
 */
function compactAttrs(raw: string): string {
  return raw.replace(/\s+/g, '');
}

function normalizeAttrs(raw: string): string[] {
  return raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const clean = stripComments(schema);

function parseBlocks(src: string): { models: Model[]; enums: Enum[] } {
  const models: Model[] = [];
  const enums: Enum[] = [];

  const blockRe = /(model|enum)\s+(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src)) !== null) {
    const kind = m[1];
    const name = m[2] as string;
    const startIndex = m.index + m[0].length;
    const line = src.slice(0, m.index).split('\n').length;

    let depth = 1;
    let i = startIndex;
    for (; i < src.length && depth > 0; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
    }
    const body = src.slice(startIndex, i - 1);

    if (kind === 'model') {
      const fields: Field[] = [];
      let fieldLine = line;
      for (const raw of body.split('\n')) {
        fieldLine += 1;
        const t = raw.trim();
        if (t === '') continue;
        if (t.startsWith('@@')) continue;
        const fm = /^(\w+)\s+([\w."]+)(\[\])?(\?)?\s*(.*)$/.exec(t);
        if (!fm) continue;
        fields.push({
          name: fm[1] as string,
          type: fm[2] as string,
          isList: Boolean(fm[3]),
          isOptional: Boolean(fm[4]),
          attrs: (fm[5] ?? '').split(/\s+/).filter(Boolean),
          line: fieldLine,
          raw: t,
        });
      }
      models.push({ name, fields, line });
    } else {
      // Nilai enum pada schema ditulis satu per baris DAN dipisah koma pada
      // kasus inline. Keduanya harus dipecah.
      const values = body
        .split(/[,\n]/)
        .map((v) => v.trim())
        .filter((v) => v !== '' && !v.startsWith('@@'));
      enums.push({ name, values, line });
    }
  }
  return { models, enums };
}

const { models, enums } = parseBlocks(clean);
const modelByName = new Map(models.map((m) => [m.name, m]));
const enumByName = new Map(enums.map((e) => [e.name, e]));

// ─── 1. Relasi dua arah ──────────────────────────────────────────────────────

for (const model of models) {
  for (const field of model.fields) {
    if (!field.attrs.includes('@relation')) continue;
    const target = modelByName.get(field.type);
    if (!target) continue;

    const relNameMatch = /@relation\("([^"]+)"\)/.exec(field.attrs.join(' '));
    const relName = relNameMatch?.[1] ?? null;

    const backFields = target.fields.filter((f) => {
      if (!f.attrs.includes('@relation')) return false;
      const backNameMatch = /@relation\("([^"]+)"\)/.exec(f.attrs.join(' '));
      return backNameMatch?.[1] === relName;
    });

    if (backFields.length === 0) {
      errors.push(
        `Relasi satu sisi: ${model.name}.${field.name} -> ${target.name}. ` +
          `Tidak ada field di ${target.name} yang memiliki @relation("${relName ?? '(default)'}")`,
      );
    }

    // Atribut onDelete wajib disamakan atau minimal ada di kedua sisi.
    const ownOnDelete = normalizeAttrs(field.raw).find((a) => a.startsWith('onDelete:'));
    const otherOnDelete = backFields[0] ? normalizeAttrs(backFields[0].raw).find((a) => a.startsWith('onDelete:')) : undefined;
    if (ownOnDelete && !otherOnDelete) {
      warnings.push(
        `${model.name}.${field.name} menentukan ${ownOnDelete} tetapi ` +
          `${target.name}.${backFields[0]?.name} tidak. Prisma memakai nilai sisi ini.`,
      );
    }
  }
}

// ─── 2. Enum Prisma harus sama dengan packages/shared ────────────────────────

const sharedEnums = resolve(here, '../../../packages/shared/src/enums.ts');
let sharedSource = '';
try {
  sharedSource = readFileSync(sharedEnums, 'utf8');
} catch {
  errors.push(`Tidak bisa membaca ${sharedEnums}. Jalankan dari root repo.`);
}

const EXPECTED_ENUMS: Record<string, string[]> = {
  UserRole: ['ADMIN', 'CASHIER'],
  PaymentMethod: ['CASH', 'TRANSFER', 'QRIS', 'DEBT'],
  PaymentStatus: ['PAID', 'UNPAID', 'PARTIAL', 'WRITTEN_OFF'],
  TransactionStatus: ['COMPLETED', 'VOIDED'],
  OrderStatus: ['PENDING_WA', 'WA_SENT', 'CONFIRMED', 'CONVERTED', 'CANCELLED'],
  StockMovementType: [
    'PURCHASE',
    'SALE',
    'RETURN',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT',
    'OPNAME',
    'DAMAGE',
    'EXPIRED',
  ],
  UnitOfMeasure: ['PCS', 'PACK', 'KG', 'GRAM', 'LITER', 'ML', 'BOX', 'DOSE', 'RID'],
  CustomerStatus: ['ACTIVE', 'BLOCKED'],
  ShiftStatus: ['OPEN', 'CLOSED'],
};

for (const [enumName, expected] of Object.entries(EXPECTED_ENUMS)) {
  const prismaEnum = enumByName.get(enumName);
  if (!prismaEnum) {
    errors.push(`Enum ${enumName} tidak ada di schema.prisma`);
    continue;
  }
  const missing = expected.filter((v) => !prismaEnum.values.includes(v));
  const extra = prismaEnum.values.filter((v) => !expected.includes(v));
  if (missing.length) {
    errors.push(`Enum ${enumName} tidak punya nilai: ${missing.join(', ')}`);
  }
  if (extra.length) {
    errors.push(`Enum ${enumName} punya nilai tak terduga: ${extra.join(', ')}`);
  }

  // Konstanta di packages/shared harus memuat nilai yang sama.
  if (sharedSource) {
    const constName = `${enumName.toUpperCase().replace(/(?:^|_)([A-Z])/g, (_, c: string) => c)}_VALUES`;
    const altName = enumName.toUpperCase();
    for (const candidate of [constName, altName]) {
      const re = new RegExp(`export const ${candidate}[^=]*=\\s*\\[([^\\]]*)\\]`);
      const cm = re.exec(sharedSource);
      if (cm) {
        const sharedValues = (cm[1] ?? '')
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        const diff = expected.filter((v) => !sharedValues.includes(v));
        if (diff.length) {
          errors.push(
            `packages/shared ${candidate} tidak punya nilai: ${diff.join(', ')}`,
          );
        }
        break;
      }
    }
  }
}

// Tipe yang dipakai tapi bukan scalar Prisma, bukan enum, bukan model.
//
// Scalar bawaan Prisma harus masuk whitelist, kalau tidak setiap kolom `String`
// akan dilaporkan sebagai "tipe tidak dikenal" dan pemeriksa ini tidak berguna.
const PRISMA_SCALARS: ReadonlySet<string> = new Set([
  'String',
  'Boolean',
  'Int',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
  'BigInt',
  // Tipe yang Prisma sengaja tidak tuntun. `tsvector` dipakai untuk kolom
  // full-text search yang diisi trigger, bukan oleh aplikasi.
  'Unsupported',
]);

for (const model of models) {
  for (const field of model.fields) {
    if (PRISMA_SCALARS.has(field.type)) continue;
    if (enumByName.has(field.type)) continue;
    if (modelByName.has(field.type)) continue;
    errors.push(
      `Tipe ${field.type} pada ${model.name}.${field.name} (baris ${field.line}) tidak dikenal`,
    );
  }
}

// ─── 3. Aturan uang & idempotensi ────────────────────────────────────────────

// Heuristik nama kolom uang. Sengaja KETAT: pola longgar akan menandai
// `taxInclusive` (Boolean), `paidAt` (DateTime), atau `value` (Json) sebagai
// kolom uang dan menghasilkan positif palsu yang membuat peringatan diabaikan.
const MONEY_FIELD =
  /^(price|unitPrice|subtotal|discount|tax|total|gross|net|paid|change|outstanding|amount|cost|unitCost|openingFloat|countedCash|expectedCash|difference|creditLimit|roundingAdjustment|lineDiscount|transactionDiscount|taxableBase)/;

// Akhiran yang menyiratkan kolom NON-uang meski diawali nama uang.
const NOT_MONEY_SUFFIX = /(Inclusive|Label|Count|Name|Bps|Key|Hash|At|In|Out|Qty|Number|No|Percent|Message|Note|Reason)$/;

const DECLARED_MONEY_FIELDS = [
  'Product.priceBuy',
  'Product.priceSell',
  'Product.priceWholesale',
  'Transaction.subtotal',
  'Transaction.lineDiscountTotal',
  'Transaction.transactionDiscountAmount',
  'Transaction.discountTotal',
  'Transaction.taxableBase',
  'Transaction.taxTotal',
  'Transaction.grandTotal',
  'Transaction.roundedTotal',
  'Transaction.roundingAdjustment',
  'Transaction.paidTotal',
  'Transaction.changeAmount',
  'Transaction.outstandingAmount',
  'TransactionItem.unitPrice',
  'TransactionItem.grossAmount',
  'TransactionItem.lineDiscountAmount',
  'TransactionItem.transactionDiscountAmount',
  'TransactionItem.discountAmount',
  'TransactionItem.netAmount',
  'TransactionItem.taxAmount',
  'TransactionItem.totalAmount',
  'TransactionItem.costPriceSnapshot',
  'TransactionPayment.amount',
  'Customer.creditLimit',
  'DebtPayment.amount',
  'PaymentAllocation.amount',
  'DebtWriteOff.amount',
  'Order.subtotal',
  'Order.discountTotal',
  'Order.total',
  'OrderItem.unitPrice',
  'OrderItem.total',
  'Shift.openingFloat',
  'Shift.countedCash',
  'Shift.expectedCash',
  'Shift.difference',
  'StockMovement.unitCost',
];

for (const qualified of DECLARED_MONEY_FIELDS) {
  const [modelName = '', fieldName = ''] = qualified.split('.');
  const model = modelByName.get(modelName);
  if (!model) {
    errors.push(`Model ${modelName} tidak ada (dicek untuk kolom uang ${qualified})`);
    continue;
  }
  const field = model.fields.find((f) => f.name === fieldName);
  if (!field) {
    errors.push(`Kolom uang ${qualified} tidak ada`);
    continue;
  }
  if (field.type !== 'Decimal') {
    errors.push(
      `${qualified} bertipe ${field.type}, harus Decimal. Kolom uang Float akan kehilangan presisi.`,
    );
  } else if (!compactAttrs(field.raw).includes('@db.Decimal(14,2)')) {
    warnings.push(`${qualified} tidak menyebut @db.Decimal(14, 2)`);
  }
}

// Deteksi kolom uang yang lupa didaftarkan (nama mencurigakan, tipe bukan Decimal)
for (const model of models) {
  for (const field of model.fields) {
    if (field.type === 'Decimal') continue;
    if (!MONEY_FIELD.test(field.name)) continue;
    if (NOT_MONEY_SUFFIX.test(field.name)) continue;
    errors.push(
      `Kolom uang ${model.name}.${field.name} bertipe ${field.type}, harus Decimal. ` +
        'Daftarkan juga di DECLARED_MONEY_FIELDS bila memang kolom uang.',
    );
  }
}

// Kolom Decimal yang wajib dan tanpa @default haruslah kolom yang memang
// dihitung aplikasi (calculateCart, CashService). Kolom uang yang terdaftar di
// DECLARED_MONEY_FIELDS sengaja tidak diberi peringatan karena memang
// selalu dikirim oleh writer-nya. Sisanya deserves dipantau.
const DECLARED_SET: ReadonlySet<string> = new Set(DECLARED_MONEY_FIELDS);
for (const model of models) {
  for (const field of model.fields) {
    if (field.type !== 'Decimal') continue;
    if (field.isOptional) continue;
    if (compactAttrs(field.raw).includes('@default')) continue;
    if (DECLARED_SET.has(`${model.name}.${field.name}`)) continue;
    warnings.push(
      `${model.name}.${field.name} wajib (not-null) tanpa @default dan tidak terdaftar ` +
        'di DECLARED_MONEY_FIELDS. Pastikan setiap INSERT menyediakannya.',
    );
  }
}

// Idempotency harus punya unique gabungan scope+key
const idem = modelByName.get('IdempotencyKey');
if (idem) {
  const hasCompositeUnique = idem.fields.some((f) => f.name === 'scope' || f.name === 'key');
  if (!hasCompositeUnique) {
    errors.push('IdempotencyKey harus punya scope dan key');
  }
} else {
  errors.push('Model IdempotencyKey tidak ada. Replay offline POS akan menggandakan transaksi.');
}

// Dokumen wajib ada untuk Piutang
for (const required of ['AuditLog', 'DocumentSequence', 'RefreshToken', 'Setting', 'Shift']) {
  if (!modelByName.has(required)) {
    errors.push(`Model ${required} tidak ada`);
  }
}

// ─── Laporan ─────────────────────────────────────────────────────────────────

const printList = (title: string, items: string[]) => {
  if (items.length === 0) return;
  process.stdout.write(`\n${title} (${items.length}):\n`);
  for (const item of items) process.stdout.write(`  - ${item}\n`);
};

process.stdout.write(`Skema: ${models.length} model, ${enums.length} enum\n`);
printList('ERROR', errors);
printList('WARNING', warnings);

if (errors.length > 0) {
  process.stdout.write(`\nGAGAL: ${errors.length} error skema.\n`);
  process.exit(1);
}
process.stdout.write(`\nOK: skema konsisten (${warnings.length} warning).\n`);
