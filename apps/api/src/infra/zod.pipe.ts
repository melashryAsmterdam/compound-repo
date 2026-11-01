import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ValidationFailed } from './errors.js';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationFailed(
        parsed.error.issues.map((i) => ({ field: i.path.join('.') || '_', code: i.code })),
      );
    }
    return parsed.data;
  }
}
