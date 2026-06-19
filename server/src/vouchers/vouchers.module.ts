import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserVoucher,
  UserVoucherSchema,
} from './schemas/user-voucher.schema';
import { Voucher, VoucherSchema } from './schemas/voucher.schema';
import {
  MeVouchersController,
  VouchersController,
} from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Voucher.name, schema: VoucherSchema },
      { name: UserVoucher.name, schema: UserVoucherSchema },
    ]),
  ],
  controllers: [VouchersController, MeVouchersController],
  providers: [VouchersService],
  // Re-export MongooseModule so other modules (e.g. orders) can inject the
  // Voucher / UserVoucher models without re-registering the schemas.
  exports: [VouchersService, MongooseModule],
})
export class VouchersModule {}
