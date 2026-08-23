import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export enum ReminderType {
  Days30 = 'DAYS_30',
  Days14 = 'DAYS_14',
  Days7 = 'DAYS_7',
  Days3 = 'DAYS_3',
  Days1 = 'DAYS_1',
  StartDay = 'START_DAY',
  Custom = 'CUSTOM',
}

export class CreateReminderDto {
  @ApiProperty()
  @IsUUID()
  exhibitionId!: string;

  @ApiProperty({ enum: ReminderType })
  @IsEnum(ReminderType)
  type!: ReminderType;

  /**
   * Only meaningful for CUSTOM; the fixed types carry their own offset.
   * Requiring it for CUSTOM and rejecting it otherwise keeps a reminder from
   * claiming to be "7 days before" while holding a different number.
   */
  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @ValidateIf((dto: CreateReminderDto) => dto.type === ReminderType.Custom)
  @IsInt()
  @Min(0)
  @Max(365)
  offsetDays?: number;

  @ApiPropertyOptional({ example: '09:00', description: 'Local time in the exhibition city' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'offsetTime must look like 09:00' })
  offsetTime?: string;
}

export class ReminderDto {
  @ApiProperty() id!: string;
  @ApiProperty() exhibitionId!: string;
  @ApiProperty() exhibitionTitle!: string;
  @ApiProperty() type!: string;
  @ApiProperty() offsetDays!: number;
  @ApiProperty() offsetTime!: string;

  /** Null while the exhibition date is still UNKNOWN. */
  @ApiPropertyOptional() remindAt!: string | null;

  @ApiPropertyOptional() exhibitionStart!: string | null;
  @ApiProperty() timezone!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isSent!: boolean;
  @ApiProperty() createdAt!: string;
}
