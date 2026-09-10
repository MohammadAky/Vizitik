import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BaleService } from './bale.service';
import { BaleController } from './bale.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [BaleController],
  providers: [BaleService, PrismaService],
  exports: [BaleService],
})
export class BaleModule {}
