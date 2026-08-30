import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'finance' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ required: false, example: 'Commission config, reconciliation, payout approval' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [String], example: ['wallet.commission.edit', 'wallet.reconcile'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys: string[];
}
