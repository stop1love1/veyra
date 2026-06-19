import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from '../common/roles.enum';
import { User, UserDocument } from './schemas/user.schema';

/**
 * Loose write payload for create/update. Accepts validated DTO shapes
 * (whose nested/optional fields are looser than the persisted schema classes).
 */
export type UserWrite = {
  email?: string;
  passwordHash?: string;
  name?: string;
  role?: Role;
  status?: string;
  coins?: number;
  avatar?: unknown;
  sellerProfile?: unknown;
  lastLoginAt?: Date;
};

/**
 * Strictly the fields a user may change about themselves. Privileged fields
 * (role/coins/status/passwordHash/email) are intentionally excluded so the
 * self-service update path can never escalate privileges or inflate coins,
 * regardless of DTO shape or pipe configuration.
 */
export type ProfileWrite = {
  name?: string;
  avatar?: unknown;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByIdOrFail(id: string): Promise<UserDocument> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  create(data: UserWrite): Promise<UserDocument> {
    // Loose write payload is validated upstream by class-validator DTOs;
    // cast at the Mongoose boundary (avatar/sellerProfile are sub-docs).
    return this.userModel.create({
      ...data,
      email: data.email?.toLowerCase(),
    } as Partial<User>);
  }

  async update(id: string, data: UserWrite): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(id, data, { new: true })
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Self-service profile update. Allow-lists only name/avatar so role, coins,
   * status, passwordHash etc. can never be written through this path.
   */
  async updateProfile(id: string, data: ProfileWrite): Promise<UserDocument> {
    const patch: ProfileWrite = {};
    if (data.name !== undefined) {
      patch.name = data.name;
    }
    if (data.avatar !== undefined) {
      patch.avatar = data.avatar;
    }
    return this.update(id, patch);
  }

  list(): Promise<UserDocument[]> {
    return this.userModel.find().sort({ createdAt: -1 }).exec();
  }

  async setRole(id: string, role: Role): Promise<UserDocument> {
    // Guard against removing the last admin, which would lock everyone out of
    // every admin-gated endpoint (list/setRole are admin-only).
    if (role !== Role.Admin) {
      const target = await this.findById(id);
      if (target?.role === Role.Admin) {
        const adminCount = await this.userModel
          .countDocuments({ role: Role.Admin })
          .exec();
        if (adminCount <= 1) {
          throw new BadRequestException('Cannot demote the last admin');
        }
      }
    }
    return this.update(id, { role });
  }
}
