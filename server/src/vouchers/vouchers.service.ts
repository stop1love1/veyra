import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserVoucher,
  UserVoucherDocument,
} from './schemas/user-voucher.schema';
import { Voucher, VoucherDocument } from './schemas/voucher.schema';

/**
 * Loose write payload for voucher creation. Validated upstream by class-validator;
 * cast at the Mongoose boundary (sellerId/expiresAt are coerced here).
 */
export type VoucherWrite = {
  code: string;
  type: string;
  value: number;
  sellerId?: string;
  expiresAt?: string | Date;
  maxUses?: number;
};

@Injectable()
export class VouchersService {
  constructor(
    @InjectModel(Voucher.name)
    private readonly voucherModel: Model<VoucherDocument>,
    @InjectModel(UserVoucher.name)
    private readonly userVoucherModel: Model<UserVoucherDocument>,
  ) {}

  /**
   * List vouchers. Admins (sellerId === undefined) see all; a seller passes their
   * own id to scope the result to vouchers they own.
   */
  list(sellerId?: string): Promise<VoucherDocument[]> {
    const filter = sellerId
      ? { sellerId: new Types.ObjectId(sellerId) }
      : {};
    return this.voucherModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  /**
   * Vouchers the user owns (earned via quest/rank milestones or redeemed),
   * joined with their definitions. Used by the passport + checkout to show and
   * apply only unlocked vouchers.
   */
  async listMine(userId: string): Promise<VoucherDocument[]> {
    const uid = new Types.ObjectId(userId);
    const owned = await this.userVoucherModel.find({ userId: uid }).exec();
    if (owned.length === 0) return [];
    const ids = owned.map((uv) => uv.voucherId);
    return this.voucherModel.find({ _id: { $in: ids } }).exec();
  }

  async create(data: VoucherWrite): Promise<VoucherDocument> {
    this.assertValidValue(data.type, data.value);

    const existing = await this.voucherModel
      .findOne({ code: data.code })
      .exec();
    if (existing) {
      throw new ConflictException('Voucher code already exists');
    }
    return this.voucherModel.create({
      code: data.code,
      type: data.type,
      value: data.value,
      sellerId: data.sellerId
        ? new Types.ObjectId(data.sellerId)
        : undefined,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      maxUses: data.maxUses,
      uses: 0,
    } as Partial<Voucher>);
  }

  async findByCodeOrFail(code: string): Promise<VoucherDocument> {
    const voucher = await this.voucherModel.findOne({ code }).exec();
    if (!voucher) {
      throw new NotFoundException('Voucher not found');
    }
    return voucher;
  }

  async findByIdOrFail(id: string): Promise<VoucherDocument> {
    const voucher = await this.voucherModel.findById(id).exec();
    if (!voucher) {
      throw new NotFoundException('Voucher not found');
    }
    return voucher;
  }

  /**
   * Redeem a voucher by its id (used by the checkout/order path). Resolves the
   * voucher server-side, validates expiry/uses, atomically consumes one use and
   * records the per-user redemption — same guarantees as redeem(by code).
   */
  async redeemById(
    userId: string,
    voucherId: string,
  ): Promise<VoucherDocument> {
    const voucher = await this.findByIdOrFail(voucherId);
    const { voucher: updated } = await this.consume(userId, voucher);
    return updated;
  }

  /**
   * Redeem a voucher for a user: validate code/expiry/uses, atomically bump `uses`,
   * and record a UserVoucher. Rejects double-redeem by the same user.
   */
  async redeem(
    userId: string,
    code: string,
  ): Promise<{ voucher: VoucherDocument; userVoucher: UserVoucherDocument }> {
    const voucher = await this.findByCodeOrFail(code);
    return this.consume(userId, voucher);
  }

  /**
   * Shared redemption core: validate expiry/uses, record the per-user
   * redemption (the unique (userId, voucherId) index is the atomic gate against
   * a double-redeem race), then atomically consume one use.
   */
  private async consume(
    userId: string,
    voucher: VoucherDocument,
  ): Promise<{ voucher: VoucherDocument; userVoucher: UserVoucherDocument }> {
    if (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Voucher has expired');
    }

    if (
      typeof voucher.maxUses === 'number' &&
      voucher.uses >= voucher.maxUses
    ) {
      throw new BadRequestException('Voucher has no remaining uses');
    }

    const userObjectId = new Types.ObjectId(userId);

    // Insert the per-user redemption FIRST. The unique compound index on
    // (userId, voucherId) makes this the atomic guard against concurrent
    // double-redeem — a duplicate insert throws E11000 (code 11000) which we
    // translate into a conflict, and no `uses` is consumed for the loser.
    let userVoucher: UserVoucherDocument;
    try {
      userVoucher = await this.userVoucherModel.create({
        userId: userObjectId,
        voucherId: voucher._id,
        usedAt: new Date(),
      } as Partial<UserVoucher>);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        (err as { code?: number }).code === 11000
      ) {
        throw new ConflictException('Voucher already redeemed by this user');
      }
      throw err;
    }

    // Atomically consume one use, re-checking the limit to avoid a race.
    const updated = await this.voucherModel
      .findOneAndUpdate(
        {
          _id: voucher._id,
          $or: [
            { maxUses: { $exists: false } },
            { maxUses: null },
            { $expr: { $lt: ['$uses', '$maxUses'] } },
          ],
        },
        { $inc: { uses: 1 } },
        { new: true },
      )
      .exec();
    if (!updated) {
      // No remaining uses — roll back the redemption record we just inserted.
      await this.userVoucherModel.deleteOne({ _id: userVoucher._id }).exec();
      throw new BadRequestException('Voucher has no remaining uses');
    }

    return { voucher: updated, userVoucher };
  }

  /**
   * Per-type value bounds. percent must be 0–100; amount must be >= 0;
   * freeship ignores value. @Min(0) on the DTO covers the lower bound, but the
   * upper bound depends on `type`, so it is enforced here.
   */
  private assertValidValue(type: string, value: number): void {
    if (value < 0) {
      throw new BadRequestException('Voucher value must be >= 0');
    }
    if (type === 'percent' && value > 100) {
      throw new BadRequestException('Percent voucher value must be 0–100');
    }
  }

  /**
   * Ownership check helper: a seller may only touch their own vouchers.
   * Admins bypass via @Roles, but call this in the controller for seller scope.
   */
  assertOwner(voucher: VoucherDocument, userId: string): void {
    if (!voucher.sellerId || voucher.sellerId.toString() !== userId) {
      throw new ForbiddenException('Not allowed');
    }
  }
}
