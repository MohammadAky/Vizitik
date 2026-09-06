import { Controller, Get, Put, Body, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { VanInventoryService } from './van-inventory.service';
import { BulkUpdateInventoryDto, InventoryItemDto } from './van-inventory.dto';
import { GetUser } from '../auth/get-user.decorator';

@Controller('api/van-inventory')
@UseGuards(AuthGuard('jwt'))
export class VanInventoryController {
  constructor(@Inject(VanInventoryService) private readonly vanInventoryService: VanInventoryService) {}

  @Get()
  getInventory(@GetUser('id') userId: string) {
    return this.vanInventoryService.getInventoryForVisitor(userId);
  }

  @Put('bulk')
  updateBulk(
    @GetUser('id') userId: string,
    @Body() dto: BulkUpdateInventoryDto,
  ) {
    return this.vanInventoryService.updateBulkInventory(userId, dto);
  }

  @Put('item')
  updateSingleItem(
    @GetUser('id') userId: string,
    @Body() dto: InventoryItemDto,
  ) {
    return this.vanInventoryService.updateSingleItem(userId, dto);
  }
}
