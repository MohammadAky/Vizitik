import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  IsEnum,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PaymentMethodEnum {
  CASH = 'CASH',
  CARD = 'CARD',
  CHECK = 'CHECK',
  CREDIT = 'CREDIT',
}

export class OrderItemInputDto {
  @IsNotEmpty({ message: 'شناسه محصول الزامی است' })
  @IsString()
  productId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  cartonCount: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  unitCount: number;
}

export class CheckInputDto {
  @IsNotEmpty({ message: 'شماره چک الزامی است' })
  @IsString()
  checkNumber: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsNotEmpty({ message: 'تاریخ سررسید چک الزامی است' })
  @IsString()
  dueDate: string; // ISO date string
}

export enum DiscountKind {
  PERCENT = 'percent',
  FIXED = 'fixed',
}

/** یک پلهٔ تخفیف مرتب (درصدی یا مبلغی) — ترتیبِ اعمال دقیقاً مطابق ترتیبِ این آرایه است */
export class DiscountStepInputDto {
  @IsNotEmpty({ message: 'نوع پلهٔ تخفیف الزامی است' })
  @IsEnum(DiscountKind, { message: 'نوع پلهٔ تخفیف معتبر نیست' })
  type: DiscountKind;

  @IsNotEmpty({ message: 'مقدار پلهٔ تخفیف الزامی است' })
  @IsNumber()
  @Min(0)
  value: number;
}

export class PaymentInputDto {
  @IsNotEmpty({ message: 'نوع پرداخت الزامی است' })
  @IsEnum(PaymentMethodEnum, { message: 'نوع پرداخت معتبر نیست' })
  method: PaymentMethodEnum;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckInputDto)
  checkDetails?: CheckInputDto;
}

export class CreateOrderDto {
  @IsNotEmpty({ message: 'شناسه یکتای محلی (localUuid) الزامی است' })
  @IsString()
  localUuid: string;

  @IsNotEmpty({ message: 'شناسه مشتری الزامی است' })
  @IsString()
  customerId: string;

  @IsArray({ message: 'لیست اقلام سفارش باید آرایه باشد' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  discountPercentages?: number[]; // مثلا [5, 3, 1] برای تخفیف‌های پلکانی

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedDiscountAmount?: number; // تخفیف مبلغی مستقیم

  // پله‌های مرتب تخفیف (percent/fixed) — اگر ارسال شود ملاکِ اعمال، این ترتیب است
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscountStepInputDto)
  discountSteps?: DiscountStepInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments?: PaymentInputDto[];
}

export class UpdateOrderDto {
  @IsArray({ message: 'لیست اقلام سفارش باید آرایه باشد' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  discountPercentages?: number[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedDiscountAmount?: number;

  // پله‌های مرتب تخفیف (percent/fixed) — اگر ارسال شود ملاکِ اعمال، این ترتیب است
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscountStepInputDto)
  discountSteps?: DiscountStepInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments?: PaymentInputDto[];
}
