import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { RecordProgressDto } from './dto/record-progress.dto';
import { ProgressionService } from './progression.service';

@Controller()
export class ProgressionController {
  constructor(private readonly progression: ProgressionService) {}

  // GET /progression/config — public rank ladder + per-source rules. The client
  // mirrors this so thresholds/caps are never hardcoded in the frontend.
  @Public()
  @Get('progression/config')
  config() {
    return this.progression.getConfig();
  }

  // POST /me/progress — record one ambient progress event for the caller.
  @Post('me/progress')
  record(@Body() dto: RecordProgressDto, @CurrentUser() user: AuthUser) {
    return this.progression.recordEvent(user.userId, dto.event);
  }

  // POST /me/checkin — daily streak check-in (idempotent within a day).
  @Post('me/checkin')
  checkin(@CurrentUser() user: AuthUser) {
    return this.progression.checkin(user.userId);
  }

  // GET /leaderboard — top players by renown + the caller's own position.
  // Authenticated (it's surfaced inside the post-login passport), so the
  // viewer's `me` position is always resolvable.
  @Get('leaderboard')
  leaderboard(@Query('limit') limit: string | undefined, @CurrentUser() user: AuthUser) {
    return this.progression.leaderboard(limit ? parseInt(limit, 10) : 20, user.userId);
  }
}
