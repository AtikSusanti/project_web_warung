import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { getRequestId, type ApiError, type ApiResponse } from '../types.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode = this.resolveStatusCode(exception);
    const { code, message, details } = this.resolvePayload(exception, statusCode);

    const body: ApiResponse<never> = {
      success: false,
      data: null,
      error: {
        code,
        message,
        statusCode,
        details,
        requestId: getRequestId(request),
      },
    } satisfies ApiError;

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json(body);
  }

  private resolveStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolvePayload(
    exception: unknown,
    statusCode: number,
  ): { code: string; message: string; details?: Record<string, string[]> } {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { code: this.deriveCode(statusCode), message: payload };
      }
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const message =
          typeof record.message === 'string'
            ? record.message
            : Array.isArray(record.message)
              ? record.message.join('; ')
              : exception.message;
        const details = this.toDetails(record.details) ?? this.toDetails(record.message);
        const code = typeof record.code === 'string' ? record.code : this.deriveCode(statusCode);
        return { code, message, details };
      }
      return { code: this.deriveCode(statusCode), message: exception.message };
    }

    if (exception instanceof Error) {
      return { code: 'INTERNAL_ERROR', message: exception.message };
    }

    return { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' };
  }

  private toDetails(value: unknown): Record<string, string[]> | undefined {
    if (Array.isArray(value)) {
      return { validation: value.map((item) => String(item)) };
    }
    if (typeof value === 'object' && value !== null) {
      const details: Record<string, string[]> = {};
      for (const [key, item] of Object.entries(value)) {
        if (Array.isArray(item)) details[key] = item.map((entry) => String(entry));
      }
      return Object.keys(details).length > 0 ? details : undefined;
    }
    return undefined;
  }

  private deriveCode(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      default:
        return statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }
}
