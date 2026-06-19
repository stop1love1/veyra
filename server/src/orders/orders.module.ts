import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartModule } from '../cart/cart.module';
import { ProductsModule } from '../products/products.module';
import { ShopsModule } from '../shops/shops.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order, OrderSchema } from './schemas/order.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    // Cart/Product/Shop models the service injects come from these modules
    // (each re-exports MongooseModule for its schema). VouchersModule provides
    // VouchersService for server-side voucher resolution at checkout.
    CartModule,
    ProductsModule,
    ShopsModule,
    VouchersModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  // Export OrdersService + re-export MongooseModule so other modules can inject
  // the Order model without re-registering the schema.
  exports: [OrdersService, MongooseModule],
})
export class OrdersModule {}
