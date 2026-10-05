import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RealtimeEvent } from '../lib/events';

/** Public base URL for links in emails/referrals: APP_URL, or the host the browser used. */
export function publicBaseUrl(req: FastifyRequest): string {
  const configured = req.server.ctx.config.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol)
    .split(',')[0]!
    .trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
    .split(',')[0]!
    .trim();
  return `${proto}://${host}`;
}

/** Server-Sent Events: one long-lived response, heartbeats keep proxies from closing it. */
export function openEventStream(
  req: FastifyRequest,
  reply: FastifyReply,
  subscribe: (send: (e: RealtimeEvent) => void) => () => void,
): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\n\n`);
  const send = (e: RealtimeEvent) => {
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data ?? {})}\n\n`);
  };
  send({ type: 'ready', data: { at: new Date().toISOString() } });
  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25_000);
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.raw.on('close', close);
  res.on('error', close);
}

export function csvReply(reply: FastifyReply, filename: string, body: string): FastifyReply {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(body);
}
