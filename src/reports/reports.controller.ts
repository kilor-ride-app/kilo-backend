import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReportFormat, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { ExportReportDto } from './dto/export-report.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { ScheduleReportDto } from './dto/schedule-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('reports.view')
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('riders')
  riders(@Query() query: ReportQueryDto) {
    return this.reports.ridersReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @Get('drivers')
  drivers(@Query() query: ReportQueryDto) {
    return this.reports.driversReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @Get('rides')
  rides(@Query() query: ReportQueryDto) {
    return this.reports.ridesReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @Get('logistics')
  logistics(@Query() query: ReportQueryDto) {
    return this.reports.logisticsReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @Get('business')
  business(@Query() query: ReportQueryDto) {
    return this.reports.businessReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @Get('kilowatt')
  kilowatt(@Query() query: ReportQueryDto) {
    return this.reports.kilowattReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @Get('finance')
  finance(@Query() query: ReportQueryDto) {
    return this.reports.financeReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @Get('support')
  support(@Query() query: ReportQueryDto) {
    return this.reports.supportReport(this.reports.resolvePeriod(query.from, query.to));
  }

  @HttpCode(HttpStatus.OK)
  @Header('Content-Disposition', 'attachment; filename="report.csv"')
  @Post('export')
  async export(@Body() dto: ExportReportDto) {
    const period = this.reports.resolvePeriod(dto.from, dto.to);
    const rows = await this.reports.generate(dto.type, period);
    const csv = this.reports.exportCsv(rows, dto.format ?? ReportFormat.CSV);
    return new StreamableFile(Buffer.from(csv, 'utf-8'), { type: 'text/csv' });
  }

  @HttpCode(HttpStatus.OK)
  @Post('schedule')
  scheduleReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: ScheduleReportDto) {
    return this.reports.scheduleReport(user.userId, dto);
  }
}
