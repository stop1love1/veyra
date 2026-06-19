import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Npc, NpcSchema } from './schemas/npc.schema';
import { NpcsController } from './npcs.controller';
import { NpcsService } from './npcs.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Npc.name, schema: NpcSchema }]),
  ],
  controllers: [NpcsController],
  providers: [NpcsService],
  // Export NpcsService and re-export MongooseModule so other modules (e.g.
  // shops, maps) can inject the Npc model without re-registering the schema.
  exports: [NpcsService, MongooseModule],
})
export class NpcsModule {}
