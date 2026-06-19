import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { ProductsService } from '../products/products.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { ShopDocument } from './schemas/shop.schema';
import { ShopsService } from './shops.service';

@Controller('shops')
export class ShopsController {
  constructor(
    private readonly shopsService: ShopsService,
    private readonly productsService: ProductsService,
  ) {}

  // PUBLIC: browse published shops.
  @Public()
  @Get()
  list() {
    return this.shopsService.listPublished();
  }

  // PUBLIC: a single shop by slug.
  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.shopsService.findBySlugOrFail(slug);
  }

  // PUBLIC: products belonging to a shop. Verifies the shop exists then
  // delegates to the products module (active products only).
  @Public()
  @Get(':id/products')
  async listProducts(@Param('id') id: string) {
    await this.shopsService.findByIdOrFail(id);
    return this.productsService.findAll(id);
  }

  // [Seller | Admin] create. Seller owns the new shop (sellerId = caller).
  @Roles(Role.Seller)
  @Post()
  create(@Body() dto: CreateShopDto, @CurrentUser() user: AuthUser) {
    return this.shopsService.create(dto, user.userId);
  }

  // [Seller(own) | Admin] update.
  @Roles(Role.Seller)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateShopDto,
    @CurrentUser() user: AuthUser,
  ) {
    const shop = await this.shopsService.findByIdOrFail(id);
    this.assertOwnerOrAdmin(shop, user);
    return this.shopsService.update(id, dto);
  }

  // [Seller(own) | Admin] delete.
  @Roles(Role.Seller)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const shop = await this.shopsService.findByIdOrFail(id);
    this.assertOwnerOrAdmin(shop, user);
    await this.shopsService.remove(id);
    return { deleted: true };
  }

  /**
   * A seller may only mutate their own shop; Admin may touch any.
   * (RolesGuard already lets Admin through @Roles(Role.Seller).)
   */
  private assertOwnerOrAdmin(shop: ShopDocument, user: AuthUser) {
    if (
      user.role !== Role.Admin &&
      shop.sellerId.toString() !== user.userId
    ) {
      throw new ForbiddenException('Not allowed to modify this shop');
    }
  }
}
