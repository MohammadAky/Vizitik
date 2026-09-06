import { IsNotEmpty, IsNumber, IsString, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class InventoryItemDto {
  @IsNotEmpty({ message: 'شناسه محصول الزامی است' })
  @IsString()
  productId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0, { message: 'تعداد کارتن نمی‌تواند منفی باشد' })
  quantityCartons: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0, { message: 'تعداد تکی نمی‌تواند منفی باشد' })
  quantityUnits: number;
}

export class BulkUpdateInventoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryItemDto)
  items: InventoryItemDto[];
}
