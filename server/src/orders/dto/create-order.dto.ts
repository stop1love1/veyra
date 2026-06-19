import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A line passed explicitly by the client (the "passed lines payload" path).
 * The client supplies only productId/qty/size/color — name, price and shopId
 * are ALWAYS snapshotted server-side from the referenced product so they can
 * never be tampered with. When the cart path is used this array is left empty.
 */
export class CreateOrderLineDto {
  @IsMongoId()
  productId: string;

  @IsInt()
  @Min(1)
  qty: number;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsInt()
  color?: number;
}

class OrderPaymentDto {
  @IsOptional()
  @IsString()
  method?: string;
}

class OrderShippingDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateOrderDto {
  // Optional explicit lines. When omitted the order is built from the user's cart.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines?: CreateOrderLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderPaymentDto)
  payment?: OrderPaymentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderShippingDto)
  shipping?: OrderShippingDto;

  @IsOptional()
  @IsMongoId()
  voucherId?: string;
}
