import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { CreateMapInstanceDto } from './dto/create-map-instance.dto';
import { CreateMapDto } from './dto/create-map.dto';
import { UpdateMapInstanceDto } from './dto/update-map-instance.dto';
import { UpdateMapDto } from './dto/update-map.dto';
import {
  MapInstance,
  MapInstanceDocument,
} from './schemas/map-instance.schema';
import { Map, MapDocument } from './schemas/map.schema';

/**
 * Loose write payloads for create/update. Validated upstream by class-validator
 * DTOs; nested/optional fields are looser than the persisted schema classes,
 * so we cast at the Mongoose boundary.
 */
type MapWrite = Partial<CreateMapDto> & {
  version?: number;
  status?: string;
  publishedAt?: Date;
  createdBy?: Types.ObjectId;
};

type MapInstanceWrite = Omit<Partial<CreateMapInstanceDto>, 'itemId'> & {
  mapId?: Types.ObjectId;
  itemId?: Types.ObjectId;
};

@Injectable()
export class MapsService {
  constructor(
    @InjectModel(Map.name) private readonly mapModel: Model<MapDocument>,
    @InjectModel(MapInstance.name)
    private readonly instanceModel: Model<MapInstanceDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // --- Maps ---------------------------------------------------------------

  /** Public read: a published map by slug. */
  async findPublishedBySlug(slug: string): Promise<MapDocument> {
    const map = await this.mapModel
      .findOne({ slug, status: 'published' })
      .exec();
    if (!map) {
      throw new NotFoundException('Map not found');
    }
    return map;
  }

  async findByIdOrFail(id: string): Promise<MapDocument> {
    const map = await this.mapModel.findById(id).exec();
    if (!map) {
      throw new NotFoundException('Map not found');
    }
    return map;
  }

  async create(dto: CreateMapDto, createdBy: string): Promise<MapDocument> {
    const existing = await this.mapModel
      .findOne({ slug: dto.slug })
      .select('_id')
      .exec();
    if (existing) {
      throw new ConflictException('Map slug already in use');
    }
    return this.mapModel.create({
      ...dto,
      createdBy: new Types.ObjectId(createdBy),
    } as MapWrite as Partial<Map>);
  }

  async update(id: string, dto: UpdateMapDto): Promise<MapDocument> {
    // A published map is an immutable snapshot the client serves; edits must
    // happen on a draft. Reject in-place edits of a published map.
    await this.assertDraft(id);

    if (dto.slug) {
      const clash = await this.mapModel
        .findOne({ slug: dto.slug, _id: { $ne: id } })
        .select('_id')
        .exec();
      if (clash) {
        throw new ConflictException('Map slug already in use');
      }
    }
    const map = await this.mapModel
      .findByIdAndUpdate(id, dto as MapWrite as Partial<Map>, { new: true })
      .exec();
    if (!map) {
      throw new NotFoundException('Map not found');
    }
    return map;
  }

  /**
   * Bump version, mark published, stamp publishedAt. Only a draft may be
   * published (lifecycle is draft → published); re-publishing or resurrecting an
   * archived map is rejected so version isn't bumped without a real change.
   */
  async publish(id: string): Promise<MapDocument> {
    const map = await this.mapModel
      .findOneAndUpdate(
        { _id: id, status: 'draft' },
        {
          $inc: { version: 1 },
          $set: { status: 'published', publishedAt: new Date() },
        },
        { new: true },
      )
      .exec();
    if (!map) {
      // Distinguish "not found" from "not in draft" for a clearer error.
      const existing = await this.mapModel
        .findById(id)
        .select('_id')
        .exec();
      if (!existing) {
        throw new NotFoundException('Map not found');
      }
      throw new ConflictException('Only a draft map can be published');
    }
    return map;
  }

  /** Throw unless the map exists and is in draft status. */
  private async assertDraft(id: string): Promise<void> {
    const map = await this.mapModel.findById(id).select('status').exec();
    if (!map) {
      throw new NotFoundException('Map not found');
    }
    if (map.status === 'published') {
      throw new ConflictException(
        'Published map is immutable; edit a draft instead',
      );
    }
  }

  // --- Map instances ------------------------------------------------------

  /** Public read: instances of a published map (optionally filtered by layer). */
  async listPublishedInstances(
    mapId: string,
    layer?: string,
  ): Promise<MapInstanceDocument[]> {
    const map = await this.mapModel
      .findOne({ _id: mapId, status: 'published' })
      .select('_id')
      .exec();
    if (!map) {
      throw new NotFoundException('Map not found');
    }
    const filter: Record<string, unknown> = {
      mapId: new Types.ObjectId(mapId),
    };
    if (layer) {
      filter.layer = layer;
    }
    return this.instanceModel.find(filter).exec();
  }

  async createInstance(
    mapId: string,
    dto: CreateMapInstanceDto,
  ): Promise<MapInstanceDocument> {
    await this.assertDraft(mapId);
    await this.assertItemActive(dto.itemId);
    return this.instanceModel.create({
      ...dto,
      mapId: new Types.ObjectId(mapId),
      itemId: new Types.ObjectId(dto.itemId),
    } as MapInstanceWrite as Partial<MapInstance>);
  }

  async updateInstance(
    mapId: string,
    iid: string,
    dto: UpdateMapInstanceDto,
  ): Promise<MapInstanceDocument> {
    await this.assertDraft(mapId);
    const { itemId, ...rest } = dto;
    if (itemId) {
      await this.assertItemActive(itemId);
    }
    const patch: MapInstanceWrite = {
      ...rest,
      ...(itemId ? { itemId: new Types.ObjectId(itemId) } : {}),
    };
    const instance = await this.instanceModel
      .findOneAndUpdate(
        { _id: iid, mapId: new Types.ObjectId(mapId) },
        patch as Partial<MapInstance>,
        { new: true },
      )
      .exec();
    if (!instance) {
      throw new NotFoundException('Map instance not found');
    }
    return instance;
  }

  async removeInstance(mapId: string, iid: string): Promise<{ ok: true }> {
    await this.assertDraft(mapId);
    const result = await this.instanceModel
      .findOneAndDelete({ _id: iid, mapId: new Types.ObjectId(mapId) })
      .exec();
    if (!result) {
      throw new NotFoundException('Map instance not found');
    }
    return { ok: true };
  }

  /**
   * Verify the referenced item exists and is active before it is placed, so a
   * dangling itemId (which the client would silently fail to render) can't be
   * persisted. Read directly from the items collection (owned by ItemsModule).
   */
  private async assertItemActive(itemId: string): Promise<void> {
    const item = await this.connection
      .collection<{ _id: Types.ObjectId; status?: string }>('items')
      .findOne({ _id: new Types.ObjectId(itemId) });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.status && item.status !== 'active') {
      throw new BadRequestException('Item is not active');
    }
  }
}
