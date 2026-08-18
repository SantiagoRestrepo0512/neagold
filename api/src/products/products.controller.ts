import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query
} from '@nestjs/common'
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../roles/permissions.decorator'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { ProductsService } from './products.service'

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('products:create')
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.create(dto, user.id)
  }

  @Get()
  @RequirePermissions('products:read')
  list(@Query() query: Record<string, unknown>) {
    return this.productsService.list(this.productsService.parseListQuery(query))
  }

  @Get(':id')
  @RequirePermissions('products:read')
  detail(@Param('id') id: string) {
    return this.productsService.findById(id)
  }

  @Patch(':id')
  @RequirePermissions('products:update')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.update(id, dto, user.id)
  }
}