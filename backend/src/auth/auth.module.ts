import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from '../prisma.service';
import { JwtStrategy } from './jwt.strategy';

// امضاکنندهٔ JWT هیچ کلید پیش‌فرضی ندارد؛ نبودِ آن باید زودتر از همه‌چیز متوقف کند
const jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret) {
  throw new Error(
    'JWT_SECRET is not set. Copy backend/.env.example to backend/.env and put a long random value in it.',
  );
}

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '30d') as JwtSignOptions['expiresIn'] },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService, JwtStrategy],
  exports: [AuthService, PassportModule, JwtModule],
})
export class AuthModule {}
