import type { VercelRequest, VercelResponse } from '@vercel/node';

export function sendError(res: VercelResponse, error: unknown): void {
  const e = error as any;
  const status = Number(e?.statusCode) || 500;
  res.status(status).json({
    error: status >= 500 ? 'GitHub writer gateway error' : e?.message ?? 'Request failed',
    detail: status >= 500 ? String(e?.message ?? e) : undefined,
  });
}

export function method(req: VercelRequest, allowed: string[]): void {
  if (!req.method || !allowed.includes(req.method)) {
    throw Object.assign(new Error('Method not allowed'), { statusCode: 405 });
  }
}

export function queryString(req: VercelRequest, name: string): string {
  const value = req.query[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
