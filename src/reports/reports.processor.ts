import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ReportFormat } from '@prisma/client';
import { Job } from 'bullmq';
import { EmailService } from '../integrations/email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { REPORTS_QUEUE, ReportsService } from './reports.service';

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // each tick covers the trailing 30 days, regardless of frequency

@Processor(REPORTS_QUEUE)
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly email: EmailService,
  ) {
    super();
  }

  async process(job: Job<{ scheduledReportId: string }>) {
    const schedule = await this.prisma.scheduledReport.findUnique({
      where: { id: job.data.scheduledReportId },
    });
    if (!schedule || !schedule.isActive) {
      return; // deactivated since this tick was queued — nothing to send
    }

    const to = new Date();
    const from = new Date(to.getTime() - LOOKBACK_MS);
    const rows = await this.reports.generate(schedule.type, { from, to });
    const csv = this.reports.exportCsv(rows, schedule.format ?? ReportFormat.CSV);

    await this.email.sendWithAttachment(
      schedule.recipientEmail,
      `Kilo ${schedule.type.toLowerCase()} report — ${to.toISOString().slice(0, 10)}`,
      `<p>Attached: the ${schedule.type.toLowerCase()} report for ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.</p>`,
      {
        filename: `${schedule.type.toLowerCase()}-report-${to.toISOString().slice(0, 10)}.csv`,
        content: Buffer.from(csv, 'utf-8'),
      },
    );

    await this.prisma.scheduledReport.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date() },
    });
    this.logger.log(`Sent scheduled ${schedule.type} report to ${schedule.recipientEmail}`);
  }
}
