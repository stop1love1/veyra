import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/current-user.decorator';

export interface JwtPayload {
  sub: string;
  role: string;
  /** Token type — distinguishes access vs refresh tokens. */
  typ?: 'access' | 'refresh';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Required + validated at bootstrap (see config/env.validation.ts); no fallback.
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthUser {
    // A refresh token must never be accepted as a Bearer access token. Tokens
    // minted before the typ claim existed (typ undefined) are treated as access.
    if (payload.typ === 'refresh') {
      throw new UnauthorizedException('Invalid access token');
    }
    return { userId: payload.sub, role: payload.role };
  }
}
