import { SetMetadata } from '@nestjs/common';
import { Role } from './roles.enum';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or controller) to the given roles.
 * Admin is always allowed (see RolesGuard). No @Roles() = open to any authenticated user.
 *
 *   @Roles(Role.Seller) POST /shops
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
