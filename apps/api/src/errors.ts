import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { errorMessage, type Locale } from '@compound/i18n';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './infra/logger';

/** A stable, localisable error (Problem.code). Every code must exist in @compound/i18n ERRORS. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const notFound = () => new DomainError('not_found', 404);
export const forbidden = (code = 'forbidden') => new DomainError(code, 403);

function localeOf(req: Request): Locale {
  return String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';
}

/** RFC 9457 problem+json for every error. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const locale = localeOf(req);
    let status = 500;
    let code = 'internal_error';
    let extra: Record<string, unknown> = {};
    if (err instanceof DomainError) {
      ({ status, code, extra } = err);
    } else if (err instanceof ZodError) {
      status = 422;
      code = 'validation_failed';
      extra = {
        errors: err.issues.map((i) => ({ field: i.path.join('.'), code: typeof i.message === 'string' && /^[a-z_]+$/.test(i.message) ? i.message : i.code })),
      };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === 404 ? 'not_found' : status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 400 ? 'validation_failed' : 'internal_error';
    } else {
      logger.error({ err, path: req.path }, 'unhandled error');
    }
    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://docs.compound.example.sa/problems/${code}`,
        title: errorMessage(code, locale),
        status,
        code,
        traceId: req.headers['x-cloud-trace-context'] ?? undefined,
        ...extra,
      });
  }
}
