import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OtherCompanyError } from '@mono/db';
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
    // A row that is not there — or is another company's, which the company wall makes the same thing.
    if ((err as { code?: string }).code === 'P2025' || err instanceof OtherCompanyError) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    }
    // Two requests made the same thing at the same moment (a unique value already taken), or the database
    // asked for one of two clashing transactions to be tried again: the person's own doing, not a fault.
    const dbCode = (err as { code?: string }).code;
    if (dbCode === 'P2002' || dbCode === 'P2034') {
      request.log.warn({ err: { code: dbCode, message: err.message } }, 'Conflict in the database');
      return reply.status(409).send({
        error: {
          code: 'CONFLICT',
          message:
            dbCode === 'P2002'
              ? 'This already exists, or was made a moment ago. Refresh and try again.'
              : 'Somebody changed this at the same moment. Try again.',
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
