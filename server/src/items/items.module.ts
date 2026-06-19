import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { Item, ItemSchema } from './schemas/item.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Item.name, schema: ItemSchema }]),
  ],
  controllers: [ItemsController],
  providers: [ItemsService],
  // Export ItemsService and re-export MongooseModule so other modules
  // (e.g. maps, products, npcs) can inject the Item model without
  // re-registering the schema.
  exports: [ItemsService, MongooseModule],
})
export class ItemsModule {}
