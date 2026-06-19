import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateItemDto } from './dto/create-item.dto';
import { QueryItemsDto } from './dto/query-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { Item, ItemDocument } from './schemas/item.schema';

/**
 * Loose write payload for create/update. Accepts validated DTO shapes
 * (whose nested/optional fields are looser than the persisted schema classes).
 */
type ItemWrite = Partial<CreateItemDto> & { createdBy?: Types.ObjectId };

@Injectable()
export class ItemsService {
  constructor(
    @InjectModel(Item.name) private readonly itemModel: Model<ItemDocument>,
  ) {}

  list(query: QueryItemsDto = {}): Promise<ItemDocument[]> {
    const filter: Record<string, unknown> = {};
    if (query.category) {
      filter.category = query.category;
    }
    if (query.tag) {
      filter.tags = query.tag;
    }
    return this.itemModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  findById(id: string): Promise<ItemDocument | null> {
    return this.itemModel.findById(id).exec();
  }

  async findByIdOrFail(id: string): Promise<ItemDocument> {
    const item = await this.findById(id);
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item;
  }

  async create(dto: CreateItemDto, createdBy: string): Promise<ItemDocument> {
    const existing = await this.itemModel.findOne({ key: dto.key }).exec();
    if (existing) {
      throw new ConflictException(`Item with key "${dto.key}" already exists`);
    }
    // Loose write payload is validated upstream by class-validator DTOs;
    // cast at the Mongoose boundary (asset/collision/etc are sub-docs).
    const data: ItemWrite = {
      ...dto,
      createdBy: new Types.ObjectId(createdBy),
    };
    return this.itemModel.create(data as Partial<Item>);
  }

  async update(id: string, dto: UpdateItemDto): Promise<ItemDocument> {
    if (dto.key) {
      const clash = await this.itemModel
        .findOne({ key: dto.key, _id: { $ne: id } })
        .exec();
      if (clash) {
        throw new ConflictException(
          `Item with key "${dto.key}" already exists`,
        );
      }
    }
    const item = await this.itemModel
      .findByIdAndUpdate(id, dto as Partial<Item>, { new: true })
      .exec();
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item;
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const res = await this.itemModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Item not found');
    }
    return { deleted: true };
  }
}
