import { ApiProperty } from '@nestjs/swagger';

export class CatalogStatsDto {
  @ApiProperty()
  categoryCount!: number;

  @ApiProperty()
  productCount!: number;

  @ApiProperty({
    description:
      'Count of Products with available=true on this Branch. Not operationalReady.',
  })
  availableProductCount!: number;
}

export class CatalogCategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({
    description:
      'Customer-facing catalog visibility for this Branch Category. Inactive Categories remain stored and editable. Products under an inactive Category must not become customer-orderable merely because Product.available=true.',
  })
  active!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CatalogCategoryListResponseDto {
  @ApiProperty({ type: [CatalogCategoryResponseDto] })
  categories!: CatalogCategoryResponseDto[];
}

export class CatalogBootstrapResponseDto {
  @ApiProperty()
  branchId!: string;

  @ApiProperty({ type: CatalogStatsDto })
  stats!: CatalogStatsDto;

  @ApiProperty({ type: [CatalogCategoryResponseDto] })
  categories!: CatalogCategoryResponseDto[];
}

export class CatalogProductSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  categoryId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({
    description:
      'Integer minor units. JSON number within a safe integer range.',
  })
  priceMinor!: number;

  @ApiProperty({
    description:
      'Whether this Product is currently offered for ordering from this Branch. Not archive, draft/published, stock, or opening hours. false is not deletion.',
  })
  available!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CatalogOptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'Integer minor units added to the product list price.',
  })
  additionalPriceMinor!: number;

  @ApiProperty({
    description:
      'Whether this Option may be selected. Not an archive flag. false keeps the row stored.',
  })
  available!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CatalogOptionGroupResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description:
      'required=true requires minSelections>=1. required=false requires minSelections=0.',
  })
  required!: boolean;

  @ApiProperty({
    description:
      'Must be >= 1 when required=true, and exactly 0 when required=false.',
  })
  minSelections!: number;

  @ApiProperty({
    description: 'Must be >= 1 and >= minSelections.',
  })
  maxSelections!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: [CatalogOptionResponseDto] })
  options!: CatalogOptionResponseDto[];
}

export class CatalogProductDetailResponseDto extends CatalogProductSummaryResponseDto {
  @ApiProperty({ type: [CatalogOptionGroupResponseDto] })
  optionGroups!: CatalogOptionGroupResponseDto[];
}

export class CatalogProductListResponseDto {
  @ApiProperty({ type: [CatalogProductSummaryResponseDto] })
  items!: CatalogProductSummaryResponseDto[];

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  total!: number;
}

export class CatalogOptionGroupListResponseDto {
  @ApiProperty({ type: [CatalogOptionGroupResponseDto] })
  optionGroups!: CatalogOptionGroupResponseDto[];
}

export class CatalogDeletedResponseDto {
  @ApiProperty()
  deleted!: true;
}
