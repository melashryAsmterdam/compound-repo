/** A rule violation with a stable code; the API maps it to application/problem+json. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}
