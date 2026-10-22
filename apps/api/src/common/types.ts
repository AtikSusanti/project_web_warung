import { Request, Response } from 'express';

export interface RequestWithUser extends Request {
  user: {
    sub: string;
    username: string;
    role: 'ADMIN' | 'CASHIER';
    iat?: number;
    exp?: number;
  };
}

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: unknown;
  error: null;
};

export type ApiError = {
  success: false;
  data: null;
  meta?: unknown;
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: Record<string, string[]>;
    requestId?: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function getRequestId(req: Request): string | undefined {
  const rid = (req.headers['x-request-id'] ?? req.headers['x-correlation-id']) as string | undefined;
  return rid ?? undefined;
}

export function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0]?.split(',')[0]?.trim();
  }
  return req.socket.remoteAddress ?? undefined;
}

export function getUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : undefined;
}