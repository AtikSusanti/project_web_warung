import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, map, catchError, throwError } from 'rxjs';

import type { ApiResponse } from '../types.js';

interface SuccessEnvelope<T> {
  success?: boolean;
  data?: T;
  meta?: unknown;
  error?: unknown;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    if (context.getType() !== 'http') {
      return next.handle() as Observable<ApiResponse<T>>;
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((payload) => this.toSuccess(payload)),
      catchError((err: unknown) => throwError(() => err)),
    ) as Observable<ApiResponse<T>>;
  }

  private toSuccess(payload: T): ApiResponse<T> {
    if (this.isEnvelope(payload)) {
      const meta = payload.meta;
      return {
        success: true,
        data: payload.data as T,
        meta,
        error: null,
      };
    }

    return {
      success: true,
      data: payload,
      error: null,
    };
  }

  private isEnvelope(value: unknown): value is SuccessEnvelope<T> {
    return (
      typeof value === 'object' &&
      value !== null &&
      'success' in value &&
      (value as SuccessEnvelope<T>).success !== undefined
    );
  }
}
