import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { ActivityService } from './activity.service';
import { ListActivityQueryDto } from './dto/list-activity-query.dto';

// Tapping an item opens its full view: GET /rides/{id} or /deliveries/{id}
// (or /battery-swap/reservations/{id}), keyed by `kind` + `id`.
@ApiTags('activity')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListActivityQueryDto) {
    return this.activity.list(user.userId, query.type, query.take, query.skip);
  }
}
