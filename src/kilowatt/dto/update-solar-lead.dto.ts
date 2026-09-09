import { PartialType } from '@nestjs/swagger';
import { CreateSolarLeadDto } from './create-solar-lead.dto';

// All lead fields are editable from the dashboard (status change, reassign,
// contact-detail corrections).
export class UpdateSolarLeadDto extends PartialType(CreateSolarLeadDto) {}
