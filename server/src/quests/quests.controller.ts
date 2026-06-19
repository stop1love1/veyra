import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { CreateQuestDto } from './dto/create-quest.dto';
import { UpdateQuestDto } from './dto/update-quest.dto';
import { QuestsService } from './quests.service';

@Controller()
export class QuestsController {
  constructor(private readonly questsService: QuestsService) {}

  // ---- Public ---------------------------------------------------------------

  // GET /quests — open catalogue of active quests.
  @Public()
  @Get('quests')
  list() {
    return this.questsService.listActive();
  }

  // ---- User -----------------------------------------------------------------

  // GET /me/quests — the caller's progress joined with each active quest.
  @Get('me/quests')
  myQuests(@CurrentUser() user: AuthUser) {
    return this.questsService.listForUser(user.userId);
  }

  // POST /me/quests/:id/claim — award the quest reward once.
  @Post('me/quests/:id/claim')
  claim(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.questsService.claim(user.userId, id);
  }

  // ---- Admin ----------------------------------------------------------------

  // POST /quests — create a quest definition.
  @Roles(Role.Admin)
  @Post('quests')
  create(@Body() dto: CreateQuestDto) {
    return this.questsService.create(dto);
  }

  // PATCH /quests/:id — update a quest definition.
  @Roles(Role.Admin)
  @Patch('quests/:id')
  update(@Param('id') id: string, @Body() dto: UpdateQuestDto) {
    return this.questsService.update(id, dto);
  }
}
