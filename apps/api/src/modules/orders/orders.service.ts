import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  normalizeIndonesianPhone,
  rupiahToSen,
  sen,
  WA_PHONE_PATTERN,
  type WhatsAppOrderLine,
  type WhatsAppOrderPayload,
} from '@warung/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { DocumentSequenceService } from './document-sequence.service.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docSeq: DocumentSequenceService,
  ) {}

  async create(dto: CreateOrderDto) {
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: dto.lines.map((l) => l.productId) },
        deletedAt: null,
        isActive: true,
        isPublic: true,
      },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        priceSell: true,
        stockQty: true,
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const line of dto.lines) {
      const p = productMap.get(line.productId);
      if (!p) throw new BadRequestException(`Produk ${line.productId} tidak ditemukan atau tidak aktif`);
      if (line.qty <= 0) throw new BadRequestException(`Jumlah ${p.name} harus lebih dari nol`);
      if (line.qty > p.stockQty) {
        throw new BadRequestException(
          `Stok ${p.name} tidak cukup (tersedia ${p.stockQty}, diminta ${line.qty})`,
        );
      }
    }

    const lines = dto.lines.map((line, index) => {
      const p = productMap.get(line.productId)!;
      const unitPrice = rupiahToSen(Number(p.priceSell));
      const total = sen(unitPrice * line.qty);
      return {
        productId: p.id,
        sku: p.sku,
        productName: p.name,
        unit: p.unit,
        qty: line.qty,
        unitPrice,
        total,
        stockAtOrder: p.stockQty,
        index: index + 1,
      };
    });

    const subtotal = lines.reduce((acc, l) => sen(acc + l.total), sen(0));
    const total = subtotal;

    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const storeName = settings?.storeName ?? 'Warung';
    const sellerPhoneRaw = settings?.waPhoneNumber?.trim() ?? '';
    const sellerPhone = normalizeIndonesianPhone(sellerPhoneRaw);
    if (!sellerPhone || !WA_PHONE_PATTERN.test(sellerPhone)) {
      throw new BadRequestException(
        sellerPhoneRaw
          ? 'Nomor WhatsApp penjual tidak valid. Periksa pengaturan toko.'
          : 'Nomor WhatsApp penjual belum diatur. Hubungi admin toko.',
      );
    }

    const orderNo = await this.docSeq.nextNumber('ORDER');

    const waLines: WhatsAppOrderLine[] = lines.map((l) => ({
      index: l.index,
      name: l.productName,
      qty: l.qty,
      unitPrice: l.unitPrice,
      total: l.total,
    }));

    const payload: WhatsAppOrderPayload = {
      customerName: dto.customerName,
      storeName,
      lines: waLines,
      subtotal,
      discountTotal: sen(0),
      total,
      note: dto.note,
      orderReference: orderNo,
      dateLabel: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    };

    const waMessage = buildWhatsAppMessage(payload);
    const waUrl = buildWhatsAppUrl(sellerPhone, waMessage);
    if (!waUrl) {
      throw new BadRequestException('Nomor WhatsApp penjual tidak valid. Periksa pengaturan toko.');
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNo,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          subtotal: subtotal.toString(),
          discountTotal: '0',
          total: total.toString(),
          status: 'PENDING_WA',
          note: dto.note ?? null,
          adminNote: dto.adminNote ?? null,
          waMessage,
          waUrl,
          waChannel: 'deep_link',
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              sku: l.sku,
              productName: l.productName,
              unit: l.unit,
              qty: l.qty,
              unitPrice: l.unitPrice.toString(),
              total: l.total.toString(),
              stockAtOrder: l.stockAtOrder,
            })),
          },
        },
        include: { items: true },
      });

      for (const line of lines) {
        await tx.product.update({
          where: { id: line.productId },
          data: { stockQty: { decrement: line.qty }, version: { increment: 1 } },
        });
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            type: 'SALE',
            qty: -line.qty,
            stockBefore: line.stockAtOrder,
            stockAfter: line.stockAtOrder - line.qty,
            refType: 'ORDER',
            refId: order.id,
            notes: `Order ${orderNo}`,
          },
        });
      }

      return {
        id: order.id,
        orderNo: order.orderNo,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        status: order.status,
        subtotal: order.subtotal.toString(),
        total: order.total.toString(),
        waMessage: order.waMessage,
        waUrl: order.waUrl,
        createdAt: order.createdAt,
        items: order.items.map((item) => ({
          id: item.id,
          productName: item.productName,
          sku: item.sku,
          qty: item.qty,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      };
    });
  }

  async findAll(query: {
    page?: number;
    pageSize?: number;
    status?: string;
    search?: string;
    from?: Date;
    to?: Date;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: any = { deletedAt: null };
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.search) {
      where.OR = [
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { orderNo: { contains: query.search, mode: 'insensitive' } },
        { customerPhone: { contains: query.search } },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = query.from;
      if (query.to) where.createdAt.lte = query.to;
    }

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        status: o.status,
        subtotal: o.subtotal.toString(),
        total: o.total.toString(),
        itemCount: o.items.length,
        waUrl: o.waUrl,
        createdAt: o.createdAt,
        items: o.items.map((i) => ({
          id: i.id,
          productName: i.productName,
          qty: i.qty,
          total: i.total.toString(),
        })),
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order tidak ditemukan');

    return {
      id: order.id,
      orderNo: order.orderNo,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      status: order.status,
      subtotal: order.subtotal.toString(),
      total: order.total.toString(),
      note: order.note,
      adminNote: order.adminNote,
      waMessage: order.waMessage,
      waUrl: order.waUrl,
      waSentAt: order.waSentAt,
      confirmedAt: order.confirmedAt,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        qty: i.qty,
        unit: i.unit,
        unitPrice: i.unitPrice.toString(),
        total: i.total.toString(),
        stockAtOrder: i.stockAtOrder,
      })),
    };
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findFirst({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order tidak ditemukan');

    const validTransitions: Record<string, string[]> = {
      PENDING_WA: ['WA_SENT', 'CANCELLED'],
      WA_SENT: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['CONVERTED', 'CANCELLED'],
      CONVERTED: [],
      CANCELLED: [],
    };

    const allowed = validTransitions[order.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Tidak bisa mengubah status dari ${order.status} ke ${dto.status}`,
      );
    }

    const now = new Date();
    const updateData: any = { status: dto.status };

    if (dto.status === 'WA_SENT') updateData.waSentAt = now;
    if (dto.status === 'CONFIRMED') updateData.confirmedAt = now;
    if (dto.status === 'CANCELLED') {
      updateData.cancelledAt = now;
      updateData.cancelReason = dto.note ?? null;

      for (const item of order.items) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
          select: { stockQty: true, name: true },
        });
        if (product) {
          const stockBefore = product.stockQty;
          const stockAfter = stockBefore + item.qty;
          await this.prisma.product.update({
            where: { id: item.productId },
            data: { stockQty: { increment: item.qty }, version: { increment: 1 } },
          });
          await this.prisma.stockMovement.create({
            data: {
              productId: item.productId,
              type: 'RETURN',
              qty: item.qty,
              stockBefore,
              stockAfter,
              refType: 'ORDER',
              refId: order.id,
              notes: `Order ${order.orderNo} dibatalkan`,
            },
          });
        }
      }
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: updateData,
      include: { items: true },
    });

    return {
      id: updated.id,
      orderNo: updated.orderNo,
      status: updated.status,
      waSentAt: updated.waSentAt,
      confirmedAt: updated.confirmedAt,
      cancelledAt: updated.cancelledAt,
      cancelReason: updated.cancelReason,
    };
  }
}
