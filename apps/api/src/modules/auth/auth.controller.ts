import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { adminCookieName, CONFIG, type Config } from '../../config.js';
import { ZodPipe } from '../../infra/zod.pipe.js';
import { CurrentAdmin, type AdminContext } from './admin-context.js';
import { AdminSessionGuard } from './admin-session.guard.js';
import { AuthService, SESSION_ABSOLUTE_MS, type RequestMeta } from './auth.service.js';

const Login = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });
const Verify = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^[0-9]{6}$/) });
const Resend = z.object({ challengeId: z.string().uuid() });
const Forgot = z.object({ email: z.string().email().max(254) });
const Reset = z.object({ token: z.string().min(1).max(100), newPassword: z.string().min(12).max(128) });

const meta = (req: Request): RequestMeta => ({ ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });

@Controller('admin/v1')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(Login)) body: z.infer<typeof Login>, @Req() req: Request) {
    return this.auth.login(body.email, body.password, meta(req));
  }

  @Post('auth/mfa/verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodPipe(Verify)) body: z.infer<typeof Verify>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, csrfToken, me } = await this.auth.verifyMfa(body.challengeId, body.code, meta(req));
    res.cookie(adminCookieName(this.config), token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_ABSOLUTE_MS,
    });
    return { admin: me, csrfToken };
  }

  @Post('auth/mfa/resend')
  @HttpCode(200)
  resend(@Body(new ZodPipe(Resend)) body: z.infer<typeof Resend>) {
    return this.auth.resendMfa(body.challengeId);
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  async logout(@CurrentAdmin() admin: AdminContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(admin.adminId, admin.compoundId, admin.sessionIdHash, admin);
    res.clearCookie(adminCookieName(this.config), { path: '/' });
  }

  @Post('auth/password/forgot')
  @HttpCode(202)
  async forgot(@Body(new ZodPipe(Forgot)) body: z.infer<typeof Forgot>, @Req() req: Request) {
    await this.auth.forgotPassword(body.email, meta(req));
  }

  @Post('auth/password/reset')
  @HttpCode(204)
  async reset(@Body(new ZodPipe(Reset)) body: z.infer<typeof Reset>, @Req() req: Request) {
    await this.auth.resetPassword(body.token, body.newPassword, meta(req));
  }

  @Get('me')
  @UseGuards(AdminSessionGuard)
  me(@CurrentAdmin() admin: AdminContext) {
    return this.auth.me(admin.adminId, admin.compoundId);
  }
}
