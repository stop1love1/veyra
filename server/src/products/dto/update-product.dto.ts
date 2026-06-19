import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

/**
 * Update payload — every Create field optional, EXCEPT shopId which is
 * omitted: a product cannot be moved between shops (that would bypass the
 * ownership check done against the original shop's sellerId). Adds `status`.
 */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['shopId'] as const),
) {
  @IsOptional()
  @IsString()
  @IsIn(['active', 'hidden'])
  status?: string;
}
