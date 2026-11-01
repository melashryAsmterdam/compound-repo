// Abstract class rather than interface so it can be a DI token; providers use @Inject explicitly
// because tsx/esbuild do not emit decorator metadata.
/** Never `new Date()` in business code — inject the clock so tests can move time (repo standard §4). */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
