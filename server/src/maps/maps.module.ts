import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';
import {
  MapInstance,
  MapInstanceSchema,
} from './schemas/map-instance.schema';
import { Map, MapSchema } from './schemas/map.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Map.name, schema: MapSchema },
      { name: MapInstance.name, schema: MapInstanceSchema },
    ]),
  ],
  controllers: [MapsController],
  providers: [MapsService],
  // Export MapsService and re-export MongooseModule so other modules can inject
  // the Map / MapInstance models without re-registering the schemas.
  exports: [MapsService, MongooseModule],
})
export class MapsModule {}
