import { IsEnum } from 'class-validator';
import { Role } from '../../common/roles.enum';

export class SetRoleDto {
  @IsEnum(Role)
  role: Role;
}
