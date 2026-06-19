import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsNumber,
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

export class ProductImageDto {
  @IsString()
  url: string;
}

export class CreateProductDto {
  @IsMongoId()
  shopId: string;

  @ValidateNested()
  @Type(() => I18nDto)
  name: I18nDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => I18nDto)
  blurb?: I18nDto;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  colors?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sizes?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => I18nDto)
  tags?: I18nDto[];

  @IsOptional()
  @IsMongoId()
  modelItemId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  rating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}
