import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { SetRoleDto } from './dto/set-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.Admin)
  list() {
    return this.usersService.list();
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    this.assertAdminOrSelf(id, user);
    return this.usersService.findByIdOrFail(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertAdminOrSelf(id, user);
    // Self-service path: only name/avatar may change. Privileged mutations
    // (role) go exclusively through PATCH /users/:id/role (admin-only).
    return this.usersService.updateProfile(id, dto);
  }

  @Patch(':id/role')
  @Roles(Role.Admin)
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.usersService.setRole(id, dto.role);
  }

  private assertAdminOrSelf(id: string, user: AuthUser) {
    if (user.role !== Role.Admin && user.userId !== id) {
      throw new ForbiddenException('Not allowed');
    }
  }
}
