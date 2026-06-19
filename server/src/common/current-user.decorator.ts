import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Shape of request.user populated by JwtStrategy.validate().
 */
export interface AuthUser {
  userId: string;
  role: string;
}

/**
 * Inject the authenticated user (request.user) into a handler param.
 *
 *   @Get('me') me(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
