import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DELIVERY_SCHEDULE_QUEUE, LogisticsService } from './logistics.service';

// Delayed job enqueued at booking time for a SCHEDULED delivery; fires a
// little before scheduledFor and hands the delivery to normal dispatch.
@Processor(DELIVERY_SCHEDULE_QUEUE)
export class DeliveryScheduleProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryScheduleProcessor.name);

  constructor(private readonly logistics: LogisticsService) {
    super();
  }

  async process(job: Job<{ deliveryId: string }>) {
    this.logger.log(`Releasing scheduled delivery ${job.data.deliveryId} to dispatch`);
    await this.logistics.releaseScheduledDelivery(job.data.deliveryId);
  }
}
