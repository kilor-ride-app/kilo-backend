import { PartialType } from '@nestjs/swagger';
import { CreateTariffDto } from './create-tariff.dto';

export class UpdateTariffDto extends PartialType(CreateTariffDto) {}
