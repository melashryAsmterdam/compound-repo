import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { DomainError } from '@compound/domain';
import type { Response } from 'express';
import { ValidationFailed } from './errors.js';

/** Maps every error to RFC 9457 application/problem+json with a stable `code` (ADR-006). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = 'internal_error';
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 404 ? 'not_found' : status === 400 ? 'validation_failed' : 'http_error';
    } else {
      // Message and stack only — never request bodies, which can carry PII.
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }
    const body: Record<string, unknown> = { type: 'about:blank', title: code, status, code };
    if (error instanceof ValidationFailed) body.errors = error.errors;
    res.status(status).type('application/problem+json').json(body);
  }
}
