import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AdminContext {
  adminId: string;
  compoundId: string;
  sessionIdHash: Buffer;
  ip: string | null;
  userAgent: string | null;
}

export type AdminRequest = Request & { admin?: AdminContext };

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => {
  return ctx.switchToHttp().getRequest<AdminRequest>().admin!;
});
