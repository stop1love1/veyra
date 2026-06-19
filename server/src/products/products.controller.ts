import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // PUBLIC — browse the catalogue. ?shop= accepts a shop slug or id.
  @Public()
  @Get()
  list(@Query('shop') shop?: string) {
    return this.productsService.findAll(shop);
  }

  // PUBLIC — view a single product.
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findByIdOrFail(id);
  }

  // Seller (own shop) or Admin — create a product in a shop they own.
  @Roles(Role.Seller)
  @Post()
  async create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
    await this.productsService.assertCanManage(dto.shopId, user);
    return this.productsService.create(dto);
  }

  // Seller (own shop) or Admin — edit a product in a shop they own.
  @Roles(Role.Seller)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthUser,
  ) {
    const product = await this.productsService.findByIdOrFail(id);
    await this.productsService.assertCanManage(product.shopId, user);
    return this.productsService.update(id, dto);
  }

  // Seller (own shop) or Admin — delete a product in a shop they own.
  @Roles(Role.Seller)
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const product = await this.productsService.findByIdOrFail(id);
    await this.productsService.assertCanManage(product.shopId, user);
    await this.productsService.remove(id);
  }
}
