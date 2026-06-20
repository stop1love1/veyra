import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { RolesGuard } from './common/roles.guard';
import { ItemsModule } from './items/items.module';
import { MapsModule } from './maps/maps.module';
import { NpcsModule } from './npcs/npcs.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { QuestsModule } from './quests/quests.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ShopsModule } from './shops/shops.module';
import { UsersModule } from './users/users.module';
import { validateEnv } from './config/env.validation';
import { VouchersModule } from './vouchers/vouchers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri:
          config.get<string>('MONGO_URI') ??
          'mongodb://127.0.0.1:27017/veyra',
      }),
    }),
    AuthModule,
    UsersModule,
    // FEATURE MODULES — register new domain modules below this line
    // (shops, products, items, maps, npcs, cart, orders, quests, vouchers, files, media).
    ItemsModule,
    MapsModule,
    ShopsModule,
    ProductsModule,
    NpcsModule,
    CartModule,
    OrdersModule,
    QuestsModule,
    VouchersModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global auth: JwtAuthGuard runs first (validates Bearer / honors @Public),
    // then RolesGuard enforces @Roles. Order matters.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
