import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from './http-exception.filter.js';

function makeHost() {
  const json = vi.fn();
  const status = vi.fn();
  const response = { status, json };
  status.mockReturnValue(response);

  const request = {
    method: 'POST',
    url: '/api/v1/transactions',
    headers: { 'x-request-id': 'req-1' },
    socket: { remoteAddress: '127.0.0.1' },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('meneruskan details terstruktur ke envelope error', () => {
    const { host, status, json } = makeHost();

    filter.catch(
      new ConflictException({
        code: 'TOTAL_MISMATCH',
        message: 'Total transaksi berubah. Konfirmasi ulang total terbaru.',
        details: {
          expectedTotal: ['1200000'],
          roundedTotal: ['1250000'],
        },
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      data: null,
      error: {
        code: 'TOTAL_MISMATCH',
        message: 'Total transaksi berubah. Konfirmasi ulang total terbaru.',
        statusCode: 409,
        details: {
          expectedTotal: ['1200000'],
          roundedTotal: ['1250000'],
        },
        requestId: 'req-1',
      },
    });
  });

  it('mempertahankan format details validasi dari message array', () => {
    const { host, status, json } = makeHost();

    filter.catch(
      new BadRequestException({
        message: ['name harus diisi', 'qty harus lebih dari nol'],
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      data: null,
      error: {
        code: 'BAD_REQUEST',
        message: 'name harus diisi; qty harus lebih dari nol',
        statusCode: 400,
        details: {
          validation: ['name harus diisi', 'qty harus lebih dari nol'],
        },
        requestId: 'req-1',
      },
    });
  });
});
