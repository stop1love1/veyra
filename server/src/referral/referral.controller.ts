import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { ReferralService } from './referral.service';

@Controller()
export class ReferralController {
  constructor(private readonly referral: ReferralService) {}

  // GET /me/referral — the caller's own code + successful-invite count.
  @Get('me/referral')
  mine(@CurrentUser() user: AuthUser) {
    return this.referral.myReferral(user.userId);
  }

  // GET /u/:code — public share-card data for a referral code.
  @Public()
  @Get('u/:code')
  profile(@Param('code') code: string) {
    return this.referral.publicProfile(code);
  }
}
