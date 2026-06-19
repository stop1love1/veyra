import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class AvatarDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  hue?: number;

  @IsOptional()
  @IsInt()
  skin?: number;

  @IsOptional()
  @IsString()
  style?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AvatarDto)
  avatar?: AvatarDto;
}
