import { IsInt, IsMongoId, IsOptional, IsString, Min } from 'class-validator';

/**
 * Upsert a single cart line. Identity of the line is productId + size + color;
 * qty is the absolute quantity to set for that line.
 */
export class UpsertLineDto {
  @IsMongoId()
  productId: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsInt()
  color?: number;

  @IsInt()
  @Min(1)
  qty: number;
}
