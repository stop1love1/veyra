import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Shop, ShopDocument } from './schemas/shop.schema';

/**
 * Loose write payload for create/update. Accepts validated DTO shapes
 * (whose nested/optional fields are looser than the persisted schema class).
 */
export type ShopWrite = {
  name?: unknown;
  slug?: string;
  category?: unknown;
  blurb?: unknown;
  hue?: number;
  featured?: boolean;
  status?: string;
  advisorNpcId?: string;
  interiorMapId?: string;
};

@Injectable()
export class ShopsService {
  constructor(
    @InjectModel(Shop.name) private readonly shopModel: Model<ShopDocument>,
  ) {}

  /** Public listing — only published shops. */
  listPublished(): Promise<ShopDocument[]> {
    return this.shopModel
      .find({ status: 'published' })
      .sort({ featured: -1, createdAt: -1 })
      .exec();
  }

  /** Shops owned by a given seller (newest first). */
  listMine(sellerId: string): Promise<ShopDocument[]> {
    return this.shopModel.find({ sellerId }).sort({ createdAt: -1 }).exec();
  }

  /** Public lookup by unique slug (any status). */
  async findBySlugOrFail(slug: string): Promise<ShopDocument> {
    const shop = await this.shopModel.findOne({ slug }).exec();
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    return shop;
  }

  findById(id: string): Promise<ShopDocument | null> {
    return this.shopModel.findById(id).exec();
  }

  /** Used by products (and others) to resolve a shop by id. */
  async findByIdOrFail(id: string): Promise<ShopDocument> {
    const shop = await this.findById(id);
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    return shop;
  }

  async create(data: ShopWrite, sellerId: string): Promise<ShopDocument> {
    if (data.slug) {
      const existing = await this.shopModel
        .findOne({ slug: data.slug })
        .exec();
      if (existing) {
        throw new ConflictException('Shop slug already in use');
      }
    }
    // Loose write payload is validated upstream by class-validator DTOs;
    // cast at the Mongoose boundary (name/category/blurb/stats are sub-docs,
    // sellerId/ref ids are coerced from strings to ObjectId by Mongoose).
    return this.shopModel.create({
      ...data,
      sellerId,
    } as unknown as Partial<Shop>);
  }

  async update(id: string, data: ShopWrite): Promise<ShopDocument> {
    if (data.slug) {
      const existing = await this.shopModel
        .findOne({ slug: data.slug })
        .exec();
      if (existing && existing.id !== id) {
        throw new ConflictException('Shop slug already in use');
      }
    }
    const shop = await this.shopModel
      .findByIdAndUpdate(id, data as Partial<Shop>, { new: true })
      .exec();
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    return shop;
  }

  async remove(id: string): Promise<void> {
    const res = await this.shopModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Shop not found');
    }
  }
}
