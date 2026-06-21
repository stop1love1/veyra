import { IsIn } from 'class-validator';

export class ClaimCollectionDto {
  @IsIn(['styled', 'owned'])
  tier: 'styled' | 'owned';
}
