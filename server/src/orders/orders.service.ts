import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { I18n } from '../common/i18n';
import { Role } from '../common/roles.enum';
import { VouchersService } from '../vouchers/vouchers.service';
import { CreateOrderDto, CreateOrderLineDto } from './dto/create-order.dto';
import { OrderStatus } from './dto/update-order-status.dto';
import { Order, OrderDocument, OrderLine } from './schemas/order.schema';

/**
 * Minimal shapes for foreign collections (cart, products) read during checkout.
 * The cart/products modules own these schemas; we only read a few fields.
 */
interface CartLineLean {
  productId: Types.ObjectId;
  size?: string;
  color?: number;
  qty: number;
}

interface CartLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  lines: CartLineLean[];
}

interface ProductLean {
  _id: Types.ObjectId;
  shopId: Types.ObjectId;
  name: I18n;
  price: number;
  stock: number;
  status?: string;
}

/** A fully server-resolved order line (name/price/shopId snapshotted). */
type ResolvedLine = OrderLine;

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    // Foreign models — owned by the cart/products modules (imported by
    // OrdersModule, which makes these tokens resolvable, not optional).
    @InjectModel('Cart') private readonly cartModel: Model<CartLean>,
    @InjectModel('Product') private readonly productModel: Model<ProductLean>,
    private readonly vouchersService: VouchersService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Create an order from either an explicit `lines` payload or the user's cart.
   * Product name/price/shopId are ALWAYS snapshotted server-side (never trusted
   * from the client). Stock is validated and decremented; a supplied voucher is
   * resolved server-side and applied to the server-computed total. The user's
   * cart is cleared afterward.
   */
  async create(userId: string, dto: CreateOrderDto): Promise<OrderDocument> {
    const lines =
      dto.lines && dto.lines.length > 0
        ? await this.linesFromPayload(dto.lines)
        : await this.linesFromCart(userId);

    if (lines.length === 0) {
      throw new BadRequestException('Cannot create an order with no lines');
    }

    const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

    // Resolve + apply the voucher server-side (validated, owned, redeemable).
    const { voucherId, total } = await this.applyVoucher(
      userId,
      dto.voucherId,
      subtotal,
    );

    const order = await this.orderModel.create({
      userId: new Types.ObjectId(userId),
      lines,
      total,
      status: 'pending',
      payment: { method: dto.payment?.method ?? 'cod' },
      shipping: dto.shipping ?? {},
      voucherId,
    } as Partial<Order>);

    // Decrement stock for each ordered product.
    await this.decrementStock(lines);

    // Clear the cart once the order is placed.
    await this.cartModel
      .updateOne(
        { userId: new Types.ObjectId(userId) },
        { $set: { lines: [] } },
      )
      .exec();

    return order;
  }

  /**
   * Build order lines from a client-supplied payload. Name/price/shopId are
   * ALWAYS snapshotted from the referenced product — client-supplied values are
   * ignored to prevent price/identity tampering.
   */
  private async linesFromPayload(
    payload: CreateOrderLineDto[],
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const line of payload) {
      const product = await this.loadProduct(line.productId);
      this.assertOrderable(product, line.qty);
      lines.push({
        productId: product._id,
        shopId: product.shopId,
        name: product.name,
        price: product.price,
        qty: line.qty,
        size: line.size,
        color: line.color,
      });
    }
    return lines;
  }

  /**
   * Build order lines from the user's cart, snapshotting product name/price.
   */
  private async linesFromCart(userId: string): Promise<ResolvedLine[]> {
    const cart = await this.cartModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean<CartLean | null>()
      .exec();

    if (!cart || cart.lines.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const lines: ResolvedLine[] = [];
    for (const cl of cart.lines) {
      const product = await this.loadProduct(cl.productId.toString());
      this.assertOrderable(product, cl.qty);
      lines.push({
        productId: product._id,
        shopId: product.shopId,
        name: product.name,
        price: product.price,
        qty: cl.qty,
        size: cl.size,
        color: cl.color,
      });
    }
    return lines;
  }

  private async loadProduct(productId: string): Promise<ProductLean> {
    const product = await this.productModel
      .findById(productId)
      .lean<ProductLean | null>()
      .exec();
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    return product;
  }

  /** Reject inactive products and insufficient stock. */
  private assertOrderable(product: ProductLean, qty: number): void {
    if (product.status && product.status !== 'active') {
      throw new BadRequestException(
        `Product ${product._id.toString()} is not available`,
      );
    }
    if (typeof product.stock === 'number' && product.stock < qty) {
      throw new BadRequestException(
        `Insufficient stock for product ${product._id.toString()}`,
      );
    }
  }

  /**
   * Atomically decrement stock for each line, guarding against overselling
   * under concurrency (stock must still be >= qty at write time).
   */
  private async decrementStock(lines: ResolvedLine[]): Promise<void> {
    for (const line of lines) {
      const res = await this.productModel
        .updateOne(
          { _id: line.productId, stock: { $gte: line.qty } },
          { $inc: { stock: -line.qty, sold: line.qty } },
        )
        .exec();
      if (res.matchedCount === 0) {
        throw new BadRequestException(
          `Insufficient stock for product ${line.productId.toString()}`,
        );
      }
    }
  }

  /**
   * Resolve a supplied voucher server-side and apply its discount to `subtotal`.
   * Returns the (possibly undefined) voucherId to store and the final total.
   */
  private async applyVoucher(
    userId: string,
    voucherIdRaw: string | undefined,
    subtotal: number,
  ): Promise<{ voucherId?: Types.ObjectId; total: number }> {
    if (!voucherIdRaw) {
      return { total: subtotal };
    }

    const voucher = await this.vouchersService.redeemById(userId, voucherIdRaw);

    let total = subtotal;
    if (voucher.type === 'percent') {
      const pct = Math.max(0, Math.min(100, voucher.value));
      total = subtotal - (subtotal * pct) / 100;
    } else if (voucher.type === 'amount') {
      total = subtotal - Math.max(0, voucher.value);
    }
    // 'freeship' does not affect the goods subtotal in this model.

    total = Math.max(0, Math.round(total));
    return { voucherId: voucher._id as Types.ObjectId, total };
  }

  /**
   * List orders scoped by role:
   *  - Admin  → all orders.
   *  - Seller → orders containing a line for one of the caller's OWN shops.
   *  - User   → own orders only.
   */
  async list(user: {
    userId: string;
    role: string;
  }): Promise<OrderDocument[]> {
    if (user.role === Role.Admin) {
      return this.orderModel.find().sort({ createdAt: -1 }).exec();
    }

    if (user.role === Role.Seller) {
      const ids = await this.ownedShopIds(user.userId);
      if (ids.length === 0) {
        return [];
      }
      return this.orderModel
        .find({ 'lines.shopId': { $in: ids } })
        .sort({ createdAt: -1 })
        .exec();
    }

    return this.orderModel
      .find({ userId: new Types.ObjectId(user.userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByIdOrFail(id: string): Promise<OrderDocument> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * Fetch an order, enforcing access:
   *  - Admin  → any order.
   *  - Seller → must own a shop referenced in the order's lines.
   *  - User   → must be the order owner.
   */
  async findOneScoped(
    id: string,
    user: { userId: string; role: string },
  ): Promise<OrderDocument> {
    const order = await this.findByIdOrFail(id);

    if (user.role === Role.Admin) {
      return order;
    }

    if (user.role === Role.Seller) {
      const ids = await this.ownedShopIds(user.userId);
      if (this.orderTouchesShops(order, ids)) {
        return order;
      }
      throw new ForbiddenException('Not allowed');
    }

    if (order.userId.toString() !== user.userId) {
      throw new ForbiddenException('Not allowed');
    }
    return order;
  }

  /**
   * Update an order's status. Sellers may only touch orders that contain a line
   * for one of THEIR OWN shops; admins may touch any order.
   */
  async updateStatus(
    id: string,
    status: OrderStatus,
    user: { userId: string; role: string },
  ): Promise<OrderDocument> {
    const order = await this.findByIdOrFail(id);

    if (user.role !== Role.Admin) {
      const ids = await this.ownedShopIds(user.userId);
      if (!this.orderTouchesShops(order, ids)) {
        throw new ForbiddenException('Not allowed for this order');
      }
    }

    order.status = status;
    await order.save();
    return order;
  }

  /**
   * Resolve the shop ids actually owned by a seller (shops.sellerId === userId),
   * read directly from the shops collection. Never trust client-supplied ids.
   */
  private async ownedShopIds(userId: string): Promise<Types.ObjectId[]> {
    const shops = await this.connection
      .collection('shops')
      .find(
        { sellerId: new Types.ObjectId(userId) },
        { projection: { _id: 1 } },
      )
      .toArray();
    return shops.map((s) => s._id as Types.ObjectId);
  }

  private orderTouchesShops(
    order: OrderDocument,
    shopIds: Types.ObjectId[],
  ): boolean {
    if (shopIds.length === 0) {
      return false;
    }
    const owned = new Set(shopIds.map((id) => id.toString()));
    return order.lines.some((l) => owned.has(l.shopId.toString()));
  }
}
