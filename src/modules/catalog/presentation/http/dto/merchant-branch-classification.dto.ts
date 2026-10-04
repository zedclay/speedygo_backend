import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignBranchClassificationDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Active CommerceVertical id from GET /merchant/commerce-verticals.',
  })
  @IsUUID()
  verticalId!: string;
}

export class MerchantCommerceVerticalDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  iconKey!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class MerchantCommerceVerticalListResponseDto {
  @ApiProperty({ type: [MerchantCommerceVerticalDto] })
  items!: MerchantCommerceVerticalDto[];
}

export class MerchantBranchClassificationDto {
  @ApiProperty({ format: 'uuid' })
  verticalId!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  iconKey!: string;
}

export class MerchantBranchClassificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ nullable: true, type: () => MerchantBranchClassificationDto })
  classification!: MerchantBranchClassificationDto | null;
}
