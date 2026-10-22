export interface JwtPayload {
  sub: string;
  username: string;
  role: 'ADMIN' | 'CASHIER';
  jti?: string;
}