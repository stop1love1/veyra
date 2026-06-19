import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { CartService } from './cart.service';
import { RemoveLineDto } from './dto/remove-line.dto';
import { UpsertLineDto } from './dto/upsert-line.dto';

@Controller('cart')
@Roles(Role.User)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cartService.getForUser(user.userId);
  }

  @Put('lines')
  upsertLine(@CurrentUser() user: AuthUser, @Body() dto: UpsertLineDto) {
    return this.cartService.upsertLine(user.userId, dto);
  }

  // Line identity comes from query params only:
  // DELETE /cart/lines?productId=...&size=...&color=...
  // (a single, unambiguous source; DELETE-with-body is non-standard and some
  // proxies strip it).
  @Delete('lines')
  removeLine(@CurrentUser() user: AuthUser, @Query() query: RemoveLineDto) {
    return this.cartService.removeLine(user.userId, query);
  }

  @Delete()
  clear(@CurrentUser() user: AuthUser) {
    return this.cartService.clear(user.userId);
  }
}
