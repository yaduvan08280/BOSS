import type { FastifyInstance } from 'fastify';
import type { EventListener, EventSignal, NotificationSignal } from '../lib/events';

export const SSE_HEARTBEAT_MS = 25_000;

/**
 * GET /api/events — Server-Sent Events for in-app notifications and live boards.
 * Heartbeat every 25 s keeps Cloudflare Tunnel (100 s idle timeout) from closing the stream.
 */
export async function sseRoutes(app: FastifyInstance, opts: { listener: EventListener }) {
  const open = new Set<() => void>();
  // End open streams before the server waits for connections to drain.
  app.addHook('preClose', async () => {
    for (const end of open) end();
  });

  app.get(
    '/api/events',
    { onRequest: [app.authenticate], schema: { hide: true } },
    async (request, reply) => {
      const auth = request.auth!;
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 5000\nevent: ready\ndata: {}\n\n`);

      const onEvent = (signal: EventSignal) => {
        if (signal.companyId !== auth.companyId) return;
        res.write(`id: ${signal.id}\nevent: domain\ndata: ${JSON.stringify(signal)}\n\n`);
      };
      const onNotification = (signal: NotificationSignal) => {
        if (signal.userId !== auth.userId || signal.companyId !== auth.companyId) return;
        res.write(`event: notification\ndata: ${JSON.stringify({ id: signal.id })}\n\n`);
      };
      opts.listener.on('event', onEvent);
      opts.listener.on('notification', onNotification);
      const heartbeat = setInterval(() => res.write(`: ping\n\n`), SSE_HEARTBEAT_MS);

      const close = () => {
        clearInterval(heartbeat);
        opts.listener.off('event', onEvent);
        opts.listener.off('notification', onNotification);
        open.delete(end);
      };
      const end = () => {
        close();
        res.end();
      };
      open.add(end);
      request.raw.on('close', close);
    },
  );
}
