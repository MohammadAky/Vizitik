import { IsNotEmpty, IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty({ message: 'نام بستنی الزامی است' })
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsNotEmpty({ message: 'تعداد در کارتن الزامی است' })
  @IsNumber()
  @Min(1)
  unitsPerCartonDefault: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cartonPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseUnitPrice?: number;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  unitsPerCartonDefault?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cartonPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseUnitPrice?: number;
}

export class UpdateUserProductDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  customCartonPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  customUnitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  customUnitsPerCarton?: number;

  @IsOptional()
  isActiveForUser?: boolean;
}

export class ResetBrandPricesDto {
  @IsNotEmpty({ message: 'نام برند الزامی است' })
  @IsString()
  brand: string;
}
