import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductsModule } from '../products/products.module';
import { Shop, ShopSchema } from './schemas/shop.schema';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Shop.name, schema: ShopSchema }]),
    // ProductsService backs GET /shops/:id/products.
    ProductsModule,
  ],
  controllers: [ShopsController],
  providers: [ShopsService],
  // Export ShopsService (products delegates to it) and re-export
  // MongooseModule so other modules can inject the Shop model without
  // re-registering the schema.
  exports: [ShopsService, MongooseModule],
})
export class ShopsModule {}
