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
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { CreateMapInstanceDto } from './dto/create-map-instance.dto';
import { CreateMapDto } from './dto/create-map.dto';
import { UpdateMapInstanceDto } from './dto/update-map-instance.dto';
import { UpdateMapDto } from './dto/update-map.dto';
import { MapsService } from './maps.service';

@Controller('maps')
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  // --- Public reads -------------------------------------------------------

  /** GET /maps/:slug — published map doc only. */
  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.mapsService.findPublishedBySlug(slug);
  }

  /** GET /maps/:id/instances — instances of a published map (?layer=). */
  @Public()
  @Get(':id/instances')
  listInstances(@Param('id') id: string, @Query('layer') layer?: string) {
    return this.mapsService.listPublishedInstances(id, layer);
  }

  // --- Admin editor ops ---------------------------------------------------

  @Roles(Role.Admin)
  @Post()
  create(@Body() dto: CreateMapDto, @CurrentUser() user: AuthUser) {
    return this.mapsService.create(dto, user.userId);
  }

  @Roles(Role.Admin)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMapDto) {
    return this.mapsService.update(id, dto);
  }

  @Roles(Role.Admin)
  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.mapsService.publish(id);
  }

  @Roles(Role.Admin)
  @Post(':id/instances')
  createInstance(
    @Param('id') id: string,
    @Body() dto: CreateMapInstanceDto,
  ) {
    return this.mapsService.createInstance(id, dto);
  }

  @Roles(Role.Admin)
  @Patch(':id/instances/:iid')
  updateInstance(
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Body() dto: UpdateMapInstanceDto,
  ) {
    return this.mapsService.updateInstance(id, iid, dto);
  }

  @Roles(Role.Admin)
  @Delete(':id/instances/:iid')
  removeInstance(@Param('id') id: string, @Param('iid') iid: string) {
    return this.mapsService.removeInstance(id, iid);
  }
}
