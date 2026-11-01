/** Injectable clock so business rules (expiry, auto-close, quiet hours) are testable. */
export class Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  /** Test helper. */
  advance(ms: number) {
    this.offsetMs += ms;
  }
}
