import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const MAX_CUSTOMER_CREDIT_LIMIT_SEN = 999_999_999_999;

export class CreateCustomerDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CUSTOMER_CREDIT_LIMIT_SEN)
  creditLimit?: number;
}
