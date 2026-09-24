import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { CreateSavedPlaceDto, UpdateSavedPlaceDto } from './dto/saved-place.dto';
import { SavedPlacesService } from './saved-places.service';

@ApiTags('places')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users/me/places')
export class SavedPlacesController {
  constructor(private readonly places: SavedPlacesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.places.list(user.userId);
  }

  // Declared before any ':id' route so "recent" is never read as an id.
  @Get('recent')
  recent(@CurrentUser() user: AuthenticatedUser) {
    return this.places.recent(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSavedPlaceDto) {
    return this.places.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSavedPlaceDto,
  ) {
    return this.places.update(user.userId, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.places.remove(user.userId, id);
  }
}
