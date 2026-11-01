import { DomainError } from '@compound/domain';

export interface FieldError {
  field: string;
  code: string;
}

export class ValidationFailed extends DomainError {
  constructor(readonly errors: FieldError[]) {
    super('validation_failed', 422);
  }
}

export const unauthenticated = () => new DomainError('unauthenticated', 401);
export const notFound = () => new DomainError('not_found', 404);
