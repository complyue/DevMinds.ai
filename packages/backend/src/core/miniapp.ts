import type { IncomingMessage, ServerResponse } from 'http';
import { Buffer } from 'buffer';

export type HandlerFn = (c: any) => Promise<any> | any;

/**
 * MiniApp: minimal router to replace Hono with Node.js http while keeping existing route handlers.
 * - Supports app.get/post/patch/delete(path, handler)
 * - Path params like /api/tasks/:id/...
 * - Context c: c.req.param(name), c.req.url, c.req.json(); c.json(data, status?)
 * - Global Bearer token auth delegated by caller via token argument
 */
export class MiniApp {
  private routes: Array<{
    method: string;
    path: string;
    keys: string[];
    regex: RegExp;
    handler: HandlerFn;
  }> = [];

  private add(method: string, path: string, handler: HandlerFn) {
    const keys: string[] = [];
    const regex = new RegExp(
      '^' +
        path
          .replace(/\/+/g, '/')
          .replace(/([.+*?=^!:${}()[\]|\\/])/g, '\\$1')
          .replace(/:(\w+)/g, (_m, k) => {
            keys.push(k);
            return '([^/]+)';
          }) +
        '$',
    );
    this.routes.push({ method: method.toUpperCase(), path, keys, regex, handler });
  }

  get(path: string, handler: HandlerFn) {
    this.add('GET', path, handler);
  }
  post(path: string, handler: HandlerFn) {
    this.add('POST', path, handler);
  }
  patch(path: string, handler: HandlerFn) {
    this.add('PATCH', path, handler);
  }
  delete(path: string, handler: HandlerFn) {
    this.add('DELETE', path, handler);
  }

  async handle(req: IncomingMessage, res: ServerResponse, token: string) {
    try {
      const method = (req.method || 'GET').toUpperCase();
      const urlStr = req.url ? `http://localhost${req.url}` : 'http://localhost/';
      const u = new URL(urlStr);

      // Bearer token for /api/*
      if (u.pathname.startsWith('/api')) {
        const auth = String((req.headers as any)['authorization'] || '');
        const ok = auth.startsWith('Bearer ') && auth.slice(7).trim() === token;
        if (!ok) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('WWW-Authenticate', 'Bearer');
          res.end(JSON.stringify({ ok: false, message: 'unauthorized' }));
          return;
        }
      }

      const route = this.routes.find((r) => r.method === method && r.regex.test(u.pathname));
      if (!route) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, message: 'not found' }));
        return;
      }

      const m = u.pathname.match(route.regex)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

      const ctxReq: {
        url: string;
        header: any;
        param: (name: string) => string | undefined;
        json: () => Promise<any>;
      } = {
        url: u.toString(),
        header: req.headers,
        param: (name: string) => params[name],
        async json() {
          const bufs: Buffer[] = [];
          for await (const chunk of req as any) bufs.push(Buffer.from(chunk));
          if (bufs.length === 0) return {};
          try {
            return JSON.parse(Buffer.concat(bufs).toString('utf8'));
          } catch {
            return {};
          }
        },
      };
      const c = {
        req: ctxReq,
        json(data: any, status = 200) {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(data));
        },
      };

      await Promise.resolve(route.handler(c));
      if (!res.writableEnded) {
        res.statusCode = 204;
        res.end();
      }
    } catch {
      try {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, message: 'internal error' }));
      } catch {}
    }
  }
}
