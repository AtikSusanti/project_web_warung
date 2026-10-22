import {
  MAX_LINE_DISCOUNT_BPS,
  MAX_SEN,
  MAX_TRANSACTION_DISCOUNT_BPS,
  MAX_TRANSACTION_LINES,
} from '@warung/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class TransactionLineDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_LINE_DISCOUNT_BPS)
  discountBps?: number;
}

class TransactionPaymentDto {
  @IsIn(['CASH', 'DEBT'])
  method!: 'CASH' | 'DEBT';

  @IsInt()
  @Min(1)
  @Max(MAX_SEN)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class CreateTransactionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TRANSACTION_LINES)
  @ValidateNested({ each: true })
  @Type(() => TransactionLineDto)
  lines!: TransactionLineDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_TRANSACTION_DISCOUNT_BPS)
  discountBps?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => TransactionPaymentDto)
  payments!: TransactionPaymentDto[];

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotencyKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEN)
  expectedTotal?: number;
}
