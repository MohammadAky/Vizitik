import { Module } from '@nestjs/common';
import { BaleService } from './bale.service';
import { BaleController } from './bale.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [BaleController],
  providers: [BaleService, PrismaService],
  exports: [BaleService],
})
export class BaleModule {}
