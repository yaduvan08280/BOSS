import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TransitionError } from '@mono/shared';
import { AppError } from '../lib/errors';
import { recordError } from '../modules/errors/service';

const transitionStatus = { INVALID_TRANSITION: 409, FORBIDDEN_TRANSITION: 403, GUARD_FAILED: 409 } as const;

/** Every error leaves the API as `{ error: { code, message, details? } }`. */
export default fp(async function errorsPlugin(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.status)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof TransitionError) {
      return reply
        .status(transitionStatus[err.code])
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    // A schema checked inside a service (stored settings, rule sets) is the user's input too.
    if ((err as unknown) instanceof z.ZodError) {
      const issues = (err as unknown as z.ZodError).issues;
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message:
            issues[0]?.message && issues.length === 1 ? issues[0].message : 'Some fields need attention',
          details: issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message })),
        },
      });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields need attention',
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (err.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } });
    }
    if (
      err.statusCode &&
      err.statusCode >= 400 &&
      err.statusCode < 500 &&
      !isResponseSerializationError(err)
    ) {
      return reply.status(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    request.log.error({ err }, 'Unhandled error');
    if (app.hasDecorator('prisma'))
      void recordError(app.prisma, {
        source: 'api',
        message: err.message,
        stack: err.stack ?? null,
        path: `${request.method} ${request.routeOptions.url ?? request.url.split('?')[0]}`,
        companyId: request.auth?.companyId ?? null,
        userId: request.auth?.userId ?? null,
      });
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: `No route ${request.method} ${request.url}` } });
  });
});
