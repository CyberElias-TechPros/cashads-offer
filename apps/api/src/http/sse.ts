import type { FastifyReply, FastifyRequest } from 'fastify';

export type SseSend = (event: string, data: unknown) => void;

/** Server-Sent Events with heartbeats (keeps proxies from closing idle streams). */
export function openSse(req: FastifyRequest, reply: FastifyReply, subscribe: (send: SseSend) => () => void) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // 2KB padding defeats buffering in some intermediaries.
  res.write(`: ${' '.repeat(2048)}\n\n`);
  res.write('retry: 3000\n\n');
  const send: SseSend = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('ready', { at: new Date().toISOString() });
  const unsubscribe = subscribe(send);
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(`: ping ${Date.now()}\n\n`);
  }, 20_000);
  const cleanup = () => {
    clearInterval(ping);
    unsubscribe();
  };
  req.raw.on('close', cleanup);
  res.on('error', cleanup);
}
