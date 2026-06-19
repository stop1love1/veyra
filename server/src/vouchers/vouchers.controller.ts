import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { VouchersService } from './vouchers.service';

/**
 * Admin + Seller management of vouchers.
 * - Admin sees/creates any voucher.
 * - Seller sees/creates only vouchers scoped to their own sellerId.
 */
@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  // GET /vouchers — admin: all; seller: own.
  @Get()
  @Roles(Role.Seller)
  list(@CurrentUser() user: AuthUser) {
    const sellerScope =
      user.role === Role.Admin ? undefined : user.userId;
    return this.vouchersService.list(sellerScope);
  }

  // POST /vouchers — admin: arbitrary sellerId; seller: forced to own id.
  @Post()
  @Roles(Role.Seller)
  create(@Body() dto: CreateVoucherDto, @CurrentUser() user: AuthUser) {
    const sellerId =
      user.role === Role.Admin ? dto.sellerId : user.userId;
    return this.vouchersService.create({ ...dto, sellerId });
  }
}

/**
 * User-facing redemption endpoint, mounted under /me/vouchers.
 */
@Controller('me/vouchers')
export class MeVouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  // POST /me/vouchers/:code/redeem — any authenticated user.
  @Post(':code/redeem')
  @Roles(Role.User)
  redeem(@Param('code') code: string, @CurrentUser() user: AuthUser) {
    return this.vouchersService.redeem(user.userId, code);
  }
}
