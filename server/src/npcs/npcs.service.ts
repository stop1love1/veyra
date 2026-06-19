import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { Role } from '../common/roles.enum';
import { Npc, NpcDocument } from './schemas/npc.schema';

/**
 * Loose write payload for create/update. Accepts validated DTO shapes
 * (whose nested/optional fields and string ref ids are looser than the
 * persisted schema classes). Cast at the Mongoose boundary.
 */
export type NpcWrite = {
  name?: string;
  persona?: unknown;
  appearance?: unknown;
  modelItemId?: string;
  dialogue?: unknown;
  shopId?: string;
  behavior?: unknown;
  accountUserId?: string;
  createdBy?: string;
  status?: string;
};

@Injectable()
export class NpcsService {
  constructor(
    @InjectModel(Npc.name) private readonly npcModel: Model<NpcDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Enforce seller scoping on NPC writes:
   *  - A non-admin may only attach the NPC to a shop they own
   *    (shop.sellerId === user.userId).
   *  - Only admins may set accountUserId (binds the NPC to a user account).
   * Admins bypass both checks.
   */
  async assertWriteScope(
    data: { shopId?: string; accountUserId?: string },
    user: { userId: string; role: string },
  ): Promise<void> {
    if (user.role === Role.Admin) {
      return;
    }
    if (data.accountUserId) {
      throw new ForbiddenException(
        'Only admins may link an NPC to a user account',
      );
    }
    if (data.shopId) {
      if (!isValidObjectId(data.shopId)) {
        throw new NotFoundException('Shop not found');
      }
      const shop = await this.connection
        .collection<{ _id: Types.ObjectId; sellerId?: Types.ObjectId }>('shops')
        .findOne({ _id: new Types.ObjectId(data.shopId) });
      if (!shop) {
        throw new NotFoundException('Shop not found');
      }
      if (!shop.sellerId || shop.sellerId.toString() !== user.userId) {
        throw new ForbiddenException('Not allowed to manage this shop');
      }
    }
  }

  list(): Promise<NpcDocument[]> {
    return this.npcModel.find().sort({ createdAt: -1 }).exec();
  }

  findById(id: string): Promise<NpcDocument | null> {
    return this.npcModel.findById(id).exec();
  }

  async findByIdOrFail(id: string): Promise<NpcDocument> {
    const npc = await this.findById(id);
    if (!npc) {
      throw new NotFoundException('NPC not found');
    }
    return npc;
  }

  create(data: NpcWrite): Promise<NpcDocument> {
    // Validated upstream by class-validator DTOs; cast at the Mongoose boundary
    // (persona/appearance/dialogue/behavior are sub-docs, ref ids are strings).
    return this.npcModel.create(data as Partial<Npc>);
  }

  async update(id: string, data: NpcWrite): Promise<NpcDocument> {
    const npc = await this.npcModel
      .findByIdAndUpdate(id, data as Partial<Npc>, { new: true })
      .exec();
    if (!npc) {
      throw new NotFoundException('NPC not found');
    }
    return npc;
  }

  async remove(id: string): Promise<NpcDocument> {
    const npc = await this.npcModel.findByIdAndDelete(id).exec();
    if (!npc) {
      throw new NotFoundException('NPC not found');
    }
    return npc;
  }
}
