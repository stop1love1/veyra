import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { CreateItemDto } from './dto/create-item.dto';
import { QueryItemsDto } from './dto/query-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';

/**
 * Asset library CRUD (design doc §4.4 / §6) — all routes are Admin-only.
 * (Admin always passes RolesGuard; the global JwtAuthGuard requires a token.)
 */
@Controller('items')
@Roles(Role.Admin)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  list(@Query() query: QueryItemsDto) {
    return this.itemsService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itemsService.findByIdOrFail(id);
  }

  @Post()
  create(@Body() dto: CreateItemDto, @CurrentUser() user: AuthUser) {
    return this.itemsService.create(dto, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.itemsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.itemsService.remove(id);
  }
}
