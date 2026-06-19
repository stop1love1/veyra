import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateVoucherDto {
  @IsString()
  code: string;

  @IsEnum(['percent', 'amount', 'freeship'])
  type: string;

  @IsNumber()
  @Min(0)
  value: number;

  // Optional seller owner. When omitted, the controller may default it to the
  // calling seller's id (admins may pass an explicit sellerId).
  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;
}
