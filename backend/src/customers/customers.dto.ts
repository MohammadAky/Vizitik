import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateCustomerDto {
  @IsNotEmpty({ message: 'نام مشتری یا سوپرمارکت الزامی است' })
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  initialDebt?: number;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
