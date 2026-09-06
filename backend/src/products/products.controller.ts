import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, UpdateUserProductDto, ResetBrandPricesDto } from './products.dto';
import { GetUser } from '../auth/get-user.decorator';

@Controller('api/products')
@UseGuards(AuthGuard('jwt'))
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly productsService: ProductsService) {}

  @Get()
  getProducts(@GetUser('id') userId: string) {
    return this.productsService.getProductsForUser(userId);
  }

  @Get('presets')
  getAvailablePresets() {
    return this.productsService.getAvailableCatalogPresets();
  }

  @Post()
  createProduct(@GetUser('id') userId: string, @Body() dto: CreateProductDto) {
    return this.productsService.createProductByUser(userId, dto);
  }

  @Post('reset-brand-prices')
  resetBrandPrices(@GetUser('id') userId: string, @Body() dto: ResetBrandPricesDto) {
    return this.productsService.resetBrandCustomPrices(userId, dto.brand);
  }

  @Put(':id')
  updateProduct(
    @GetUser('id') userId: string,
    @Param('id') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProductByUser(userId, productId, dto);
  }

  @Put(':id/custom-settings')
  updateCustomSettings(
    @GetUser('id') userId: string,
    @Param('id') productId: string,
    @Body() dto: UpdateUserProductDto,
  ) {
    return this.productsService.updateCustomPrice(userId, productId, dto);
  }

  @Delete(':id/custom-settings')
  resetSingleProductPrice(@GetUser('id') userId: string, @Param('id') productId: string) {
    return this.productsService.resetSingleProductPrice(userId, productId);
  }

  @Delete(':id')
  deleteUserProduct(@GetUser('id') userId: string, @Param('id') productId: string) {
    return this.productsService.deleteUserCreatedProduct(userId, productId);
  }
}
