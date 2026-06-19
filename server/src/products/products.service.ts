import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { Role } from '../common/roles.enum';
import { Product, ProductDocument } from './schemas/product.schema';

/**
 * Loose write payload for create/update. Accepts the validated DTO shapes
 * (nested/optional fields are looser than the persisted schema classes);
 * cast at the Mongoose boundary.
 */
export type ProductWrite = {
  shopId?: string;
  name?: unknown;
  blurb?: unknown;
  price?: number;
  currency?: string;
  colors?: number[];
  sizes?: string[];
  tags?: unknown;
  modelItemId?: string;
  images?: unknown;
  link?: string;
  rating?: number;
  sold?: number;
  stock?: number;
  status?: string;
};

/**
 * Minimal projection of the shops collection used only for ownership
 * resolution + slug→id lookup. We read the collection directly through the
 * Mongoose connection so this module does not own / re-register the Shop
 * schema (it lives in the shops feature module).
 */
type ShopOwnership = { _id: Types.ObjectId; sellerId?: Types.ObjectId };

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * List products. `shop` may be a shop _id or a shop slug.
   * By default only `status:'active'` products are returned (the public path);
   * pass `includeHidden=true` for an admin/seller view that also sees hidden
   * products.
   */
  async findAll(
    shop?: string,
    includeHidden = false,
  ): Promise<ProductDocument[]> {
    const filter: Record<string, unknown> = {};
    if (!includeHidden) {
      filter.status = 'active';
    }
    if (shop) {
      const shopId = await this.resolveShopId(shop);
      // Unknown shop → no products rather than a server error.
      if (!shopId) {
        return [];
      }
      filter.shopId = shopId;
    }
    return this.productModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findByIdOrFail(id: string): Promise<ProductDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Product not found');
    }
    const product = await this.productModel.findById(id).exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async create(data: ProductWrite): Promise<ProductDocument> {
    // shopId is required + validated as a Mongo id by the DTO.
    await this.assertShopExists(data.shopId);
    return this.productModel.create(data as Partial<Product>);
  }

  async update(id: string, data: ProductWrite): Promise<ProductDocument> {
    const product = await this.productModel
      .findByIdAndUpdate(id, data, { new: true })
      .exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async remove(id: string): Promise<void> {
    const res = await this.productModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Product not found');
    }
  }

  /**
   * Ownership gate: admins always pass; a seller passes only if they own the
   * shop the product belongs to (shop.sellerId === user.userId). Throws
   * ForbiddenException otherwise.
   */
  async assertCanManage(
    shopId: Types.ObjectId | string,
    user: { userId: string; role: string },
  ): Promise<void> {
    if (user.role === Role.Admin) {
      return;
    }
    const shop = await this.findShop(shopId);
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    if (!shop.sellerId || shop.sellerId.toString() !== user.userId) {
      throw new ForbiddenException('Not allowed to manage this shop');
    }
  }

  // --- shop helpers (read-only, via the raw connection) ----------------------

  private get shopsCollection() {
    return this.connection.collection<ShopOwnership>('shops');
  }

  private async assertShopExists(shopId?: string): Promise<void> {
    const shop = shopId ? await this.findShop(shopId) : null;
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
  }

  private async findShop(
    shopId: Types.ObjectId | string,
  ): Promise<ShopOwnership | null> {
    if (!isValidObjectId(shopId)) {
      return null;
    }
    return this.shopsCollection.findOne({
      _id: new Types.ObjectId(shopId),
    });
  }

  /** Resolve a shop reference (id or slug) to its ObjectId, or null. */
  private async resolveShopId(shop: string): Promise<Types.ObjectId | null> {
    if (isValidObjectId(shop)) {
      return new Types.ObjectId(shop);
    }
    const bySlug = await this.shopsCollection.findOne({
      slug: shop,
    } as Record<string, unknown>);
    return bySlug?._id ?? null;
  }
}
