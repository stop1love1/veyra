import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

// Real-time multiplayer presence + shared seat locks. No Mongoose schema — all
// state is ephemeral and in-memory (see RealtimeService).
@Module({
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
