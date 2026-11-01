import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { DomainError } from '@compound/domain';
import type { Response } from 'express';

/** Maps every error to RFC 9457 application/problem+json with a stable `code` (ADR-006). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = 'internal_error';
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 404 ? 'not_found' : 'http_error';
    }
    res.status(status).type('application/problem+json').json({ type: 'about:blank', title: code, status, code });
  }
}
