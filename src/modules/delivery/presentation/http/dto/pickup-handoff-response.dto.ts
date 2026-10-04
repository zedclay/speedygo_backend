import { ApiProperty } from '@nestjs/swagger';

export class MerchantPickupHandoffResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'Plaintext pickup code. Returned only on Merchant pickup-handoff endpoints.',
    example: '0427',
  })
  pickupCode!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  assignmentId!: string;

  @ApiProperty()
  assignmentVersion!: number;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  attemptsRemaining!: number;
}
