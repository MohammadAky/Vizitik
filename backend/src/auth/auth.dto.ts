import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'شماره تلفن الزامی است' })
  @IsString()
  phone: string;

  @IsNotEmpty({ message: 'رمز عبور الزامی است' })
  password: string;
}

export class SendRegisterOtpDto {
  @IsNotEmpty({ message: 'شماره تلفن الزامی است' })
  @IsString()
  phone: string;
}

export class RegisterWithOtpDto {
  @IsNotEmpty({ message: 'نام الزامی است' })
  @IsString()
  firstName: string;

  @IsNotEmpty({ message: 'نام خانوادگی الزامی است' })
  @IsString()
  lastName: string;

  @IsNotEmpty({ message: 'شماره تلفن الزامی است' })
  @IsString()
  phone: string;

  @IsNotEmpty({ message: 'کد تایید الزامی است' })
  @IsString()
  code: string;

  @IsNotEmpty({ message: 'رمز عبور الزامی است' })
  @MinLength(6, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' })
  password: string;

  @IsOptional()
  @IsString()
  baleChatId?: string;
}

export class SendResetPasswordOtpDto {
  @IsNotEmpty({ message: 'شماره تلفن الزامی است' })
  @IsString()
  phone: string;
}

export class ResetPasswordDto {
  @IsNotEmpty({ message: 'شماره تلفن الزامی است' })
  @IsString()
  phone: string;

  @IsNotEmpty({ message: 'کد تایید الزامی است' })
  @IsString()
  code: string;

  @IsNotEmpty({ message: 'رمز عبور جدید الزامی است' })
  @MinLength(6, { message: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد' })
  newPassword: string;
}

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsNotEmpty({ message: 'رمز عبور جدید الزامی است' })
  @MinLength(6, { message: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد' })
  newPassword: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  baleChatId?: string;
}
