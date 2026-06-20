import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { Role } from '../common/roles.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './jwt.strategy';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  coins: number;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const existing = await this.userModel.findOne({ email }).exec();
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel.create({
      email,
      passwordHash,
      name: dto.name,
      role: dto.role === 'seller' ? Role.Seller : Role.User,
      status: 'active',
      coins: 1280,
    });

    return this.issue(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    user.lastLoginAt = new Date();
    await user.save();

    return this.issue(user);
  }

  async refresh(token: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reject access tokens presented at the refresh endpoint. Even with a
    // distinct refresh secret this is defense-in-depth against token confusion.
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.userModel.findById(payload.sub).exec();
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.signTokens(user);
  }

  private async issue(user: UserDocument): Promise<AuthResult> {
    const tokens = await this.signTokens(user);
    return { ...tokens, user: this.toPublic(user) };
  }

  private async signTokens(user: UserDocument): Promise<AuthTokens> {
    // expiresIn from config is a plain string; cast to the ms StringValue union
    // the jsonwebtoken types expect.
    type ExpiresIn = JwtSignOptions['expiresIn'];

    const accessPayload: JwtPayload = {
      sub: user.id,
      role: user.role,
      typ: 'access',
    };
    const refreshPayload: JwtPayload = {
      sub: user.id,
      role: user.role,
      typ: 'refresh',
    };

    const accessOptions: JwtSignOptions = {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: (this.config.get<string>('JWT_ACCESS_TTL') ??
        '15m') as ExpiresIn,
    };

    const refreshOptions: JwtSignOptions = {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.config.get<string>('JWT_REFRESH_TTL') ??
        '7d') as ExpiresIn,
    };

    const accessToken = await this.jwtService.signAsync(
      accessPayload,
      accessOptions,
    );
    const refreshToken = await this.jwtService.signAsync(
      refreshPayload,
      refreshOptions,
    );

    return { accessToken, refreshToken };
  }

  toPublic(user: UserDocument): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      coins: user.coins,
    };
  }
}
