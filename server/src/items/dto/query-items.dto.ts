import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ITEM_CATEGORIES, type ItemCategory } from '../schemas/item.schema';

/**
 * Filters for GET /items (design doc §6: `?category=&tag=`).
 */
export class QueryItemsDto {
  @IsOptional()
  @IsEnum(ITEM_CATEGORIES)
  category?: ItemCategory;

  @IsOptional()
  @IsString()
  tag?: string;
}
