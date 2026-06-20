import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class I18nDto {
  @IsString()
  vi: string;

  @IsString()
  en: string;
}

export class QuestGoalDto {
  @IsString()
  type: string;

  @IsInt()
  @Min(1)
  count: number;
}

export class QuestRewardDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  coins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  renown?: number;

  @IsOptional()
  @IsMongoId()
  voucherId?: string;
}

export class CreateQuestDto {
  @IsString()
  key: string;

  @ValidateNested()
  @Type(() => I18nDto)
  title: I18nDto;

  @ValidateNested()
  @Type(() => QuestGoalDto)
  goal: QuestGoalDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuestRewardDto)
  reward?: QuestRewardDto;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  chapter?: number;

  @IsOptional()
  @IsBoolean()
  daily?: boolean;

  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
