import { Controller, Post, Put, Body, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import {
  LoginDto,
  SendRegisterOtpDto,
  RegisterWithOtpDto,
  SendResetPasswordOtpDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './auth.dto';
import { GetUser } from './get-user.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * ورود با شماره موبایل و رمز عبور (بدون نیاز به کد تایید بله)
   */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * ارسال کد تایید به بله برای ثبت‌نام کاربر جدید
   */
  @Post('send-register-otp')
  sendRegisterOtp(@Body() dto: SendRegisterOtpDto) {
    return this.authService.sendRegisterOtp(dto);
  }

  /**
   * تکمیل ثبت‌نام با کد تایید بله
   */
  @Post('register-with-otp')
  registerWithOtp(@Body() dto: RegisterWithOtpDto) {
    return this.authService.registerWithOtp(dto);
  }

  /**
   * ارسال کد تایید برای فراموشی و بازیابی رمز عبور
   */
  @Post('send-reset-otp')
  sendResetOtp(@Body() dto: SendResetPasswordOtpDto) {
    return this.authService.sendResetPasswordOtp(dto);
  }

  /**
   * تغییر و ثبت رمز عبور جدید با کد تایید بله
   */
  @Post('reset-password-with-otp')
  resetPasswordWithOtp(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPasswordWithOtp(dto);
  }

  /**
   * تغییر رمز عبور از تنظیمات حساب کاربری
   */
  @Put('change-password')
  @UseGuards(AuthGuard('jwt'))
  changePassword(
    @GetUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }
}
