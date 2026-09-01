import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Server-managed storage URL. Currently null until the upload pipeline exists. Not client-writable.',
  })
  avatarUrl!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CustomerAddressResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  addressText!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CustomerMeResponseDto {
  @ApiProperty({
    description:
      'False when the authenticated Account has no CustomerProfile yet. This is not an error.',
  })
  customerProfileExists!: boolean;

  @ApiProperty({
    description:
      'Derived: CustomerProfile exists and fullName is non-empty after trim. Address is not included. A profile-complete Customer may use Home without an Address.',
  })
  profileComplete!: boolean;

  @ApiProperty({
    description:
      'Derived: at least one Address exists and one of them is default. Independent of profileComplete and not required for Home.',
  })
  addressReady!: boolean;

  @ApiPropertyOptional({ type: CustomerProfileResponseDto, nullable: true })
  profile!: CustomerProfileResponseDto | null;

  @ApiProperty({ type: [CustomerAddressResponseDto] })
  addresses!: CustomerAddressResponseDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  defaultAddressId!: string | null;
}

export class CustomerAddressListResponseDto {
  @ApiProperty({ type: [CustomerAddressResponseDto] })
  addresses!: CustomerAddressResponseDto[];
}

export class CustomerDeletedResponseDto {
  @ApiProperty()
  deleted!: true;
}
