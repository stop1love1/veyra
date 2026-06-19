import { PartialType } from '@nestjs/mapped-types';
import { CreateMapInstanceDto } from './create-map-instance.dto';

export class UpdateMapInstanceDto extends PartialType(CreateMapInstanceDto) {}
