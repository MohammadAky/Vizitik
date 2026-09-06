import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';
import { GetUser } from '../auth/get-user.decorator';

@Controller('api/customers')
@UseGuards(AuthGuard('jwt'))
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customersService: CustomersService) {}

  @Get()
  getCustomers(@GetUser('id') visitorId: string) {
    return this.customersService.getCustomersForVisitor(visitorId);
  }

  @Post()
  createCustomer(@GetUser('id') visitorId: string, @Body() dto: CreateCustomerDto) {
    return this.customersService.createCustomer(visitorId, dto);
  }

  @Get(':id')
  getCustomerDetails(
    @GetUser('id') visitorId: string,
    @Param('id') customerId: string,
  ) {
    return this.customersService.getCustomerDetails(visitorId, customerId);
  }

  @Put(':id')
  updateCustomer(
    @GetUser('id') visitorId: string,
    @Param('id') customerId: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.updateCustomer(visitorId, customerId, dto);
  }

  @Delete(':id')
  deleteCustomer(
    @GetUser('id') visitorId: string,
    @Param('id') customerId: string,
  ) {
    return this.customersService.deleteCustomer(visitorId, customerId);
  }

  @Post(':id/settle')
  settleCustomerDebt(
    @GetUser('id') visitorId: string,
    @Param('id') customerId: string,
    @Body() dto: { amount: number; method: string; notes?: string },
  ) {
    return this.customersService.settleCustomerDebt(visitorId, customerId, dto);
  }
}
