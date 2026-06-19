import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  // Export UsersService and re-export MongooseModule so other modules can
  // inject the User model (e.g. AuthModule) without re-registering the schema.
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
