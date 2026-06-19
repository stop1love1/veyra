import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class I18nDto {
  @IsString()
  vi: string;

  @IsString()
  en: string;
}

export class CreateShopDto {
  @ValidateNested()
  @Type(() => I18nDto)
  name: I18nDto;

  @IsString()
  slug: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => I18nDto)
  category?: I18nDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => I18nDto)
  blurb?: I18nDto;

  @IsOptional()
  @IsNumber()
  hue?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsIn(['draft', 'published', 'suspended'])
  status?: string;

  @IsOptional()
  @IsString()
  advisorNpcId?: string;

  @IsOptional()
  @IsString()
  interiorMapId?: string;
}
