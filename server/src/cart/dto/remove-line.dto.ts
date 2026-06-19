import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, IsString } from 'class-validator';

/**
 * Identify the cart line to remove. Works as a request body or as query params
 * (DELETE /cart/lines?productId=...&size=...&color=...) — @Type coerces the
 * query string `color` to a number.
 */
export class RemoveLineDto {
  @IsMongoId()
  productId: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  color?: number;
}
