# Veyra Server — Feature Module Contract

This is the **binding contract** for every feature module author (shops, products, items,
maps, npcs, cart, orders, quests, vouchers, files, media). Follow it exactly so modules
compose cleanly and `npx tsc --noEmit` stays green.

Foundation already in place (do NOT recreate): `auth`, `users`, and everything under
`src/common`. Global guards (`JwtAuthGuard` then `RolesGuard`) and the global
`ValidationPipe` + `api` prefix are wired in `app.module.ts` / `main.ts`.

---

## 0. TL;DR — the rules

1. One folder per domain under `src/<feature>/`.
2. **Extensionless relative imports** (`./foo`, `../common/roles.enum`) — the build is
   TS via `nest build`; do NOT add `.js` extensions even though tsconfig is `nodenext`.
3. Mongoose schema via `@Schema({ timestamps: true })` + `SchemaFactory.createForClass`.
4. DTOs are `class-validator` classes. Validation is global (`whitelist:true, transform:true`)
   — no need to call the pipe yourself.
5. Register your schema with `MongooseModule.forFeature` **inside your own module**.
6. **Auth is global and on by default.** Every route requires a valid Bearer token unless
   you add `@Public()`. RBAC is opt-in per route via `@Roles(...)` (Admin always passes).
7. Add your module to the `// FEATURE MODULES` section of `src/app.module.ts`.
8. Bilingual text → embed `I18n` from `src/common/i18n.ts` (see §6).

---

## 1. Folder layout (canonical)

```
src/<feature>/
  schemas/<entity>.schema.ts     # @Schema classes + SchemaFactory exports
  dto/create-<entity>.dto.ts     # class-validator input DTOs
  dto/update-<entity>.dto.ts     # often PartialType(CreateDto) from @nestjs/mapped-types
  <feature>.service.ts           # @Injectable, injects the Mongoose model
  <feature>.controller.ts        # @Controller('<feature>'), routes + guards
  <feature>.module.ts            # forFeature + wiring
```

Sub-entities that are owned by a parent (e.g. `mapInstances` under `maps`) may live in the
parent module's folder with their own `schemas/` file and `forFeature` entry.

---

## 2. Schema (Mongoose via @nestjs/mongoose)

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

export type ShopDocument = HydratedDocument<Shop>;

@Schema({ timestamps: true }) // gives createdAt / updatedAt automatically
export class Shop {
  // Ref to another collection — store an ObjectId, type it as Types.ObjectId.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sellerId: Types.ObjectId;

  // Bilingual text — embed the I18n sub-schema (see §6).
  @Prop({ type: I18nSchema, required: true })
  name: I18n;

  @Prop({ type: String, unique: true, index: true })
  slug: string;

  @Prop({ type: String, enum: ['draft', 'published', 'suspended'], default: 'draft' })
  status: string;
}

export const ShopSchema = SchemaFactory.createForClass(Shop);
```

Rules:
- Export **three** things per entity: the class (`Shop`), the document type
  (`ShopDocument = HydratedDocument<Shop>`), and the schema (`ShopSchema`).
- The `ref` string must match the referenced class's `.name` (e.g. `'User'`, `'Shop'`).
- Arrays of sub-docs: `@Prop({ type: [I18nSchema] }) tags: I18n[];`.
- Embedded sub-objects with no own `_id`: define a `@Schema({ _id: false })` class +
  `SchemaFactory.createForClass`, then reference its schema in the parent `@Prop`.
- Keep it `strictNullChecks`-friendly: optional props use `?` AND `required: false`.

---

## 3. DTOs (class-validator)

```ts
import { IsString, IsOptional, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class I18nDto {
  @IsString() vi: string;
  @IsString() en: string;
}

export class CreateShopDto {
  @ValidateNested() @Type(() => I18nDto) name: I18nDto;
  @IsString() slug: string;
  @IsOptional() @IsNumber() hue?: number;
}
```

- Update DTOs: `export class UpdateShopDto extends PartialType(CreateShopDto) {}`
  from `@nestjs/mapped-types`.
- Validation runs globally with `{ whitelist: true, transform: true }` — unknown
  properties are stripped; primitives are coerced. Do not register a pipe yourself.
- Service `create/update` may accept a slightly looser write type than the persisted
  schema class (DTO optional/nested fields differ); cast at the Mongoose boundary if
  `Model.create` complains (see `users.service.ts` `UserWrite` for the pattern).

---

## 4. Service

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Shop, ShopDocument } from './schemas/shop.schema';

@Injectable()
export class ShopsService {
  constructor(
    @InjectModel(Shop.name) private readonly shopModel: Model<ShopDocument>,
  ) {}

  findAll() { return this.shopModel.find().exec(); }

  async findById(id: string) {
    const doc = await this.shopModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Shop not found');
    return doc;
  }
}
```

- Inject the model with `@InjectModel(Entity.name)` typed `Model<EntityDocument>`.
- Always `.exec()` queries. Throw `NotFoundException` / `ForbiddenException` /
  `ConflictException` from `@nestjs/common` rather than returning null to controllers.

---

## 5. Controller + auth decorators

```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles.enum';
import { Public } from '../common/public.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';

@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  // Open route — no token required (global JwtAuthGuard is bypassed).
  @Public()
  @Get()
  list() { return this.shopsService.findAll(); }

  // Authenticated (token required by the global guard) + RBAC: sellers & admins.
  @Roles(Role.Seller)
  @Post()
  create(@Body() dto: CreateShopDto, @CurrentUser() user: AuthUser) {
    return this.shopsService.create(dto, user.userId);
  }

  // Authenticated, any role (no @Roles) — but you enforce ownership in code.
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: AuthUser) { /* ... */ }
}
```

### Auth rules (memorize these)

| Need | Do |
|---|---|
| Public route (no token) | `@Public()` on the handler (or controller) |
| Any logged-in user | nothing — global `JwtAuthGuard` already requires a token |
| Restrict to roles | `@Roles(Role.Seller, Role.Npc)` — **Admin always passes** automatically |
| Get the caller | `@CurrentUser() user: AuthUser` → `{ userId: string; role: string }` |
| Ownership ("own shop") | no decorator exists yet; compare `user.userId` to the resource owner in the service/controller and throw `ForbiddenException` |

### CRITICAL: `AuthUser` import

`tsconfig` has `isolatedModules + emitDecoratorMetadata`. A **type** used in a decorated
method signature MUST be imported with `import type` (or it triggers TS1272). Split it:

```ts
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
```

The same applies to any other pure-type you reference in a `@Get/@Post/...` handler param.

---

## 6. I18n (bilingual text)

- Import path: **`src/common/i18n.ts`** → `import { I18n, I18nSchema } from '../common/i18n';`
  (from `src/<feature>/` it is `../common/i18n`; from `src/<feature>/schemas/` it is
  `../../common/i18n`).
- In a schema `@Prop`: `@Prop({ type: I18nSchema }) name: I18n;`
  (array: `@Prop({ type: [I18nSchema] }) tags: I18n[];`).
- `I18n` shape is `{ vi: string; en: string }`. A matching `I18nType` alias is also exported.
- In DTOs, declare an `I18nDto` (`@IsString() vi/en`) and validate with
  `@ValidateNested() @Type(() => I18nDto)`.

---

## 7. Module wiring

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shop, ShopSchema } from './schemas/shop.schema';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Shop.name, schema: ShopSchema }]),
    // To read another collection's model, import THAT feature's module
    // (it must re-export MongooseModule). Do NOT re-register a schema you
    // don't own. Example: import { UsersModule } from '../users/users.module';
  ],
  controllers: [ShopsController],
  providers: [ShopsService],
  // Re-export MongooseModule if other modules will inject your model.
  exports: [ShopsService, MongooseModule],
})
export class ShopsModule {}
```

- `forFeature([{ name: Entity.name, schema: EntitySchema }])` — register every schema your
  module owns (including owned sub-entities like `mapInstances`).
- Need another domain's model? **Import its module** (which re-exports `MongooseModule`);
  never call `forFeature` for a schema you don't own.
- Export `MongooseModule` from your module if other modules inject your model.

The shared `User` model is available by importing `UsersModule` (it re-exports
`MongooseModule` for `User`) — that is how `AuthModule` injects `User`.

---

## 8. Register the module

Add your module to `src/app.module.ts` under the marked line:

```ts
    AuthModule,
    UsersModule,
    // FEATURE MODULES — register new domain modules below this line
    ShopsModule,   // <-- add here
```

---

## 9. Reference / import-path cheat sheet

From a controller/service at `src/<feature>/`:

```ts
import { Roles }       from '../common/roles.decorator';   // Roles(...Role[])
import { Role }        from '../common/roles.enum';         // enum Role
import { Public }      from '../common/public.decorator';   // Public()
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';    // only for @UseGuards on a
                                                            // route in an otherwise-bypassed
                                                            // context; usually unnecessary
                                                            // (it's global)
import { I18n, I18nSchema } from '../common/i18n';
```

From a schema at `src/<feature>/schemas/`, prefix one more `../` (e.g. `../../common/i18n`).

`AuthUser` shape: `{ userId: string; role: string }` (set by `JwtStrategy.validate`,
JWT payload is `{ sub, role }`).

---

## 10. Before you finish

Run from `d:/projects/veyra/server`:

```
npx tsc --noEmit     # must exit 0
```

Common gotchas: missing `import type` for `AuthUser` (TS1272); forgetting `.exec()`;
re-registering a schema you don't own; adding `.js` to relative imports.
