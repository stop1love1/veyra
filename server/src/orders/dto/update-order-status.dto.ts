import { IsEnum } from 'class-validator';

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'shipped',
  'done',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export class UpdateOrderStatusDto {
  @IsEnum(ORDER_STATUSES)
  status: OrderStatus;
}
