import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

/**
 * Body for PUT /admin/settings/:key.
 * Only `value` is accepted; forbidNonWhitelisted rejects adminId spoof fields.
 * Per-key type/range validation is enforced in SettingsService (not DTO),
 * because allowlisted keys have heterogeneous types.
 */
export class UpdatePlatformSettingDto {
  @ApiProperty({
    description:
      'New setting value. Type must match the allowlisted key (string/boolean/integer).',
    oneOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'integer' }],
  })
  @Allow()
  value!: string | boolean | number;
}
