import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

  // Self-serve role at sign-up. Constrained to 'user' | 'seller' only —
  // 'admin' can never be granted through registration.
  @IsOptional()
  @IsIn(['user', 'seller'])
  role?: 'user' | 'seller';

  // Optional referral code from an inviter's share link (?ref=CODE).
  @IsOptional()
  @IsString()
  referralCode?: string;
}
