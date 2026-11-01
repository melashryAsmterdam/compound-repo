import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards, Inject } from '@nestjs/common';
import { ZodPipe } from '../../infra/zod.pipe.js';
import { CurrentAdmin, type AdminContext } from '../auth/admin-context.js';
import { AdminSessionGuard } from '../auth/admin-session.guard.js';
import { OwnerInput, UnitInput, UnitListQuery, UnitPatch } from './units.schemas.js';
import { UnitsService } from './units.service.js';

const unitId = new ParseUUIDPipe({ version: undefined });

@Controller('admin/v1/units')
@UseGuards(AdminSessionGuard)
export class UnitsController {
  constructor(@Inject(UnitsService) private readonly units: UnitsService) {}

  @Get()
  list(@CurrentAdmin() admin: AdminContext, @Query(new ZodPipe(UnitListQuery)) query: UnitListQuery) {
    return this.units.list(admin, query);
  }

  @Post()
  create(@CurrentAdmin() admin: AdminContext, @Body(new ZodPipe(UnitInput)) body: UnitInput) {
    return this.units.create(admin, body);
  }

  @Get('blocks')
  blocks(@CurrentAdmin() admin: AdminContext) {
    return this.units.blocks(admin);
  }

  @Get(':unitId')
  get(@CurrentAdmin() admin: AdminContext, @Param('unitId', unitId) id: string) {
    return this.units.get(admin, id);
  }

  @Patch(':unitId')
  update(@CurrentAdmin() admin: AdminContext, @Param('unitId', unitId) id: string, @Body(new ZodPipe(UnitPatch)) body: UnitPatch) {
    return this.units.update(admin, id, body);
  }

  @Delete(':unitId')
  @HttpCode(204)
  remove(@CurrentAdmin() admin: AdminContext, @Param('unitId', unitId) id: string) {
    return this.units.remove(admin, id);
  }

  @Put(':unitId/owner')
  assignOwner(@CurrentAdmin() admin: AdminContext, @Param('unitId', unitId) id: string, @Body(new ZodPipe(OwnerInput)) body: OwnerInput) {
    return this.units.assignOwner(admin, id, body);
  }

  @Delete(':unitId/owner')
  @HttpCode(204)
  revokeOwner(@CurrentAdmin() admin: AdminContext, @Param('unitId', unitId) id: string) {
    return this.units.revokeOwner(admin, id);
  }
}
