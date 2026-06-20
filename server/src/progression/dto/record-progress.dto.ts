import { IsString } from 'class-validator';

export class RecordProgressDto {
  // A Renown source key (e.g. 'explore', 'stylist', 'curate', 'purchase').
  // Validated against the known sources in the service.
  @IsString()
  event: string;
}
