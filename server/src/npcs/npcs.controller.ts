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
import { CreateNpcDto } from './dto/create-npc.dto';
import { UpdateNpcDto } from './dto/update-npc.dto';
import { NpcsService } from './npcs.service';
import { NpcDocument } from './schemas/npc.schema';

@Controller('npcs')
export class NpcsController {
  constructor(private readonly npcsService: NpcsService) {}

  // Open route — anyone can browse NPC entities in the world.
  @Public()
  @Get()
  list() {
    return this.npcsService.list();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.npcsService.findByIdOrFail(id);
  }

  // Admin (any NPC) or Seller (own advisors). Admin always passes RolesGuard.
  @Roles(Role.Seller)
  @Post()
  async create(@Body() dto: CreateNpcDto, @CurrentUser() user: AuthUser) {
    // Sellers may only attach to a shop they own and may not set accountUserId.
    await this.npcsService.assertWriteScope(dto, user);
    return this.npcsService.create({ ...dto, createdBy: user.userId });
  }

  @Roles(Role.Seller)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNpcDto,
    @CurrentUser() user: AuthUser,
  ) {
    const npc = await this.npcsService.findByIdOrFail(id);
    this.assertAdminOrOwner(npc, user);
    // Re-pointing shopId/accountUserId is subject to the same seller scoping.
    await this.npcsService.assertWriteScope(dto, user);
    return this.npcsService.update(id, dto);
  }

  @Roles(Role.Seller)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const npc = await this.npcsService.findByIdOrFail(id);
    this.assertAdminOrOwner(npc, user);
    return this.npcsService.remove(id);
  }

  /**
   * Admins may touch any NPC; sellers only the advisors they created.
   */
  private assertAdminOrOwner(npc: NpcDocument, user: AuthUser) {
    if (user.role === Role.Admin) {
      return;
    }
    if (npc.createdBy?.toString() !== user.userId) {
      throw new ForbiddenException('Not allowed');
    }
  }
}
