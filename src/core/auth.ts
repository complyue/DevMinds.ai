import type { IncomingMessage } from 'http';

/**
 * 生成/获取后端使用的 Bearer Token
 * 优先读取环境变量 DEVMINDS_TOKEN；若未提供则生成随机值（用于本地调试）
 */
export function getToken(): string {
  return (
    process.env.DEVMINDS_TOKEN ||
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  );
}

/**
 * HTTP 鉴权：对 /api/* 路径校验 Authorization: Bearer <token>
 */
export function isHttpAuthorized(req: IncomingMessage, token: string, pathname: string): boolean {
  if (!pathname.startsWith('/api')) return true;
  const auth = String(req.headers['authorization'] || '');
  return auth.startsWith('Bearer ') && auth.slice(7).trim() === token;
}

/**
 * WS 鉴权：要求 Sec-WebSocket-Protocol 中包含 'devminds' 与 'bearer.<token>'
 */
export function checkWsAuth(protoHeader: string | undefined, token: string): boolean {
  const raw = String(protoHeader || '');
  const protos = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasDev = protos.includes('devminds');
  const bearer = protos.find((p) => p.startsWith('bearer.'));
  return hasDev && !!bearer && bearer === `bearer.${token}`;
}
