import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { ClaimCollectionDto } from './dto/claim-collection.dto';
import { CollectionsService } from './collections.service';

@Controller()
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  // GET /collections — public catalogue of active look collections.
  @Public()
  @Get('collections')
  list() {
    return this.collections.listActive();
  }

  // GET /me/collections — the caller's claim state joined with each collection.
  @Get('me/collections')
  mine(@CurrentUser() user: AuthUser) {
    return this.collections.listForUser(user.userId);
  }

  // POST /me/collections/:key/claim — claim one tier's reward (once).
  @Post('me/collections/:key/claim')
  claim(
    @Param('key') key: string,
    @Body() dto: ClaimCollectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.collections.claim(user.userId, key, dto.tier);
  }
}
