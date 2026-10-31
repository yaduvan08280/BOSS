import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { TransitionError } from '@mono/shared';
import { AppError } from '../lib/errors';

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
