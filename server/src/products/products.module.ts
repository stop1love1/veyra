import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from './schemas/product.schema';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
    ]),
    // Shop ownership is resolved by reading the `shops` collection directly
    // through the Mongoose connection (see ProductsService), so we do NOT
    // import ShopsModule or re-register the Shop schema here. If a later
    // integration step prefers ShopsModule, swap the raw-collection lookup
    // for ShopsService without changing this module's public surface.
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  // Re-export so other modules (e.g. orders) can inject the Product model.
  exports: [ProductsService, MongooseModule],
})
export class ProductsModule {}
