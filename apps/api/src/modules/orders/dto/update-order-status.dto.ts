import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsIn(['WA_SENT', 'CONFIRMED', 'CANCELLED'])
  status!: 'WA_SENT' | 'CONFIRMED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
