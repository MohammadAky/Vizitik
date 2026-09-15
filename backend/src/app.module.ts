import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { CustomersModule } from './customers/customers.module';
import { VanInventoryModule } from './van-inventory/van-inventory.module';
import { OrdersModule } from './orders/orders.module';
import { ReportsModule } from './reports/reports.module';
import { BaleModule } from './bale/bale.module';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    AuthModule,
    ProductsModule,
    CustomersModule,
    VanInventoryModule,
    OrdersModule,
    ReportsModule,
    BaleModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
