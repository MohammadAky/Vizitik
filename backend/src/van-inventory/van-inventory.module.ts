import { Module } from '@nestjs/common';
import { VanInventoryService } from './van-inventory.service';
import { VanInventoryController } from './van-inventory.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [VanInventoryController],
  providers: [VanInventoryService, PrismaService],
  exports: [VanInventoryService],
})
export class VanInventoryModule {}
