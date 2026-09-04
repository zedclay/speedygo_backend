import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  RATING_COMMENT_MAX,
  RATING_SCORE_MAX,
  RATING_SCORE_MIN,
} from '../../../domain/ratings.policy';

/** Create rating — score + optional comment. Authority fields rejected by forbidNonWhitelisted. */
export class CreateRatingDto {
  @ApiProperty({ minimum: RATING_SCORE_MIN, maximum: RATING_SCORE_MAX })
  @IsInt()
  @Min(RATING_SCORE_MIN)
  @Max(RATING_SCORE_MAX)
  score!: number;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: RATING_COMMENT_MAX,
    description: 'Optional plain-text comment; whitespace-only becomes null',
  })
  @IsOptional()
  @IsString()
  @MinLength(0)
  @MaxLength(RATING_COMMENT_MAX)
  comment?: string | null;
}
