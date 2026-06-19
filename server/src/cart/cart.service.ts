import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from './schemas/cart.schema';
import { RemoveLineDto } from './dto/remove-line.dto';
import { UpsertLineDto } from './dto/upsert-line.dto';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
  ) {}

  /**
   * Return the caller's cart, creating an empty one on first access so GET /cart
   * always resolves to a document.
   */
  async getForUser(userId: string): Promise<CartDocument> {
    const uid = new Types.ObjectId(userId);
    const existing = await this.cartModel.findOne({ userId: uid }).exec();
    if (existing) {
      return existing;
    }
    return this.cartModel.create({ userId: uid, lines: [] });
  }

  /**
   * Upsert a line (identity = productId + size + color). If a matching line
   * exists its qty is replaced; otherwise the line is appended.
   */
  async upsertLine(userId: string, dto: UpsertLineDto): Promise<CartDocument> {
    const cart = await this.getForUser(userId);
    const size = dto.size ?? '';
    const color = dto.color ?? 0;
    const line = cart.lines.find((l) => this.matches(l, dto.productId, size, color));
    if (line) {
      line.qty = dto.qty;
    } else {
      cart.lines.push({
        productId: new Types.ObjectId(dto.productId),
        size,
        color,
        qty: dto.qty,
      });
    }
    return cart.save();
  }

  /**
   * Remove the line matching productId + size + color (defaults applied for
   * omitted size/color).
   */
  async removeLine(userId: string, dto: RemoveLineDto): Promise<CartDocument> {
    const cart = await this.getForUser(userId);
    const size = dto.size ?? '';
    const color = dto.color ?? 0;
    cart.lines = cart.lines.filter(
      (l) => !this.matches(l, dto.productId, size, color),
    );
    return cart.save();
  }

  /** Empty the caller's cart. */
  async clear(userId: string): Promise<CartDocument> {
    const cart = await this.getForUser(userId);
    cart.lines = [];
    return cart.save();
  }

  private matches(
    line: { productId: Types.ObjectId; size: string; color: number },
    productId: string,
    size: string,
    color: number,
  ): boolean {
    return (
      line.productId.toString() === productId &&
      line.size === size &&
      line.color === color
    );
  }
}
