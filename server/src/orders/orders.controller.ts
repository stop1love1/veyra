import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Place an order. Built from the user's cart, or from an explicit `lines`
   * payload in the body. Snapshots product name/price and clears the cart.
   */
  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.create(user.userId, dto);
  }

  /**
   * List orders, scoped by role:
   *  - user   → own orders.
   *  - seller → orders touching one of the caller's OWN shops (resolved
   *             server-side from shop ownership; never client-supplied).
   *  - admin  → all orders.
   */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.ordersService.list(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ordersService.findOneScoped(id, user);
  }

  /**
   * Advance an order's status. Sellers may only touch orders that contain a
   * line for one of their OWN shops (resolved server-side); admins, any order.
   */
  @Patch(':id/status')
  @Roles(Role.Seller)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.updateStatus(id, dto.status, user);
  }
}
