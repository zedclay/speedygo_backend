import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerStorefrontListQueryDto } from '../presentation/http/dto/customer-catalog.dto';
import {
  captureOpenNowLocalParts,
  intervalsOpenAtLocal,
} from '../../merchants/domain/opening-hours.open-now-filter';
import { isOpenAt } from '../../merchants/domain/opening-hours.evaluator';
import {
  normalizeIntervalTimes,
  type NormalizedOpeningInterval,
} from '../../merchants/domain/opening-hours.policy';
import { ISO_DAYS_OF_WEEK } from '../../merchants/domain/opening-hours.constants';

function interval(
  dayOfWeek: number,
  opens: string,
  closes: string,
): NormalizedOpeningInterval {
  const [oh, om] = opens.split(':').map(Number);
  const [ch, cm] = closes.split(':').map(Number);
  const times = normalizeIntervalTimes(oh * 60 + om, ch * 60 + cm);
  return {
    dayOfWeek: dayOfWeek as NormalizedOpeningInterval['dayOfWeek'],
    opensMinute: times.opensMinute,
    closesMinute: times.closesMinute,
    closesNextDay: times.closesNextDay,
    sortOrder: 0,
  };
}

describe('openNow list filter predicate', () => {
  const cases: Array<{
    name: string;
    now: Date;
    intervals: NormalizedOpeningInterval[];
    expectOpen: boolean;
  }> = [
    {
      name: 'same-day open interior',
      now: new Date('2024-01-15T10:00:00.000Z'), // Mon 11:00 Algiers
      intervals: [interval(1, '09:00', '17:00')],
      expectOpen: true,
    },
    {
      name: 'exact opening inclusive',
      now: new Date('2024-01-15T08:00:00.000Z'), // Mon 09:00 Algiers
      intervals: [interval(1, '09:00', '17:00')],
      expectOpen: true,
    },
    {
      name: 'exact closing exclusive',
      now: new Date('2024-01-15T16:00:00.000Z'), // Mon 17:00 Algiers
      intervals: [interval(1, '09:00', '17:00')],
      expectOpen: false,
    },
    {
      name: 'closed before open',
      now: new Date('2024-01-15T07:00:00.000Z'), // Mon 08:00 Algiers
      intervals: [interval(1, '09:00', '17:00')],
      expectOpen: false,
    },
    {
      name: 'unconfigured empty intervals',
      now: new Date('2024-01-15T10:00:00.000Z'),
      intervals: [],
      expectOpen: false,
    },
    {
      name: 'overnight same evening',
      now: new Date('2024-01-15T22:00:00.000Z'), // Mon 23:00 Algiers
      intervals: [interval(1, '22:00', '02:00')],
      expectOpen: true,
    },
    {
      name: 'overnight after midnight still open',
      now: new Date('2024-01-16T00:00:00.000Z'), // Tue 01:00 Algiers
      intervals: [interval(1, '22:00', '02:00')],
      expectOpen: true,
    },
    {
      name: 'overnight exact close closed',
      now: new Date('2024-01-16T01:00:00.000Z'), // Tue 02:00 Algiers
      intervals: [interval(1, '22:00', '02:00')],
      expectOpen: false,
    },
    {
      name: '24h 00:00→00:00 always open',
      now: new Date('2024-01-15T10:00:00.000Z'),
      intervals: ISO_DAYS_OF_WEEK.map((d) => interval(d, '00:00', '00:00')),
      expectOpen: true,
    },
    {
      name: '24h 00:00→00:00 open at night (Algiers ~03:55)',
      // 2026-09-15T02:55:00Z = Tue 03:55 Africa/Algiers (ISO dow=2)
      now: new Date('2026-09-15T02:55:00.000Z'),
      intervals: ISO_DAYS_OF_WEEK.map((d) => interval(d, '00:00', '00:00')),
      expectOpen: true,
    },
    {
      name: '24h 00:00→00:00 open at local midnight',
      // 2024-01-15T23:00:00Z = Tue 00:00 Africa/Algiers
      now: new Date('2024-01-15T23:00:00.000Z'),
      intervals: ISO_DAYS_OF_WEEK.map((d) => interval(d, '00:00', '00:00')),
      expectOpen: true,
    },
    {
      name: 'overnight still open just after midnight',
      now: new Date('2024-01-16T00:30:00.000Z'), // Tue 01:30 Algiers
      intervals: [interval(1, '22:00', '02:00')],
      expectOpen: true,
    },
  ];

  for (const entry of cases) {
    it(`${entry.name}: local predicate matches isOpenAt`, () => {
      const local = captureOpenNowLocalParts(entry.now);
      expect(intervalsOpenAtLocal(entry.intervals, local)).toBe(
        entry.expectOpen,
      );
      expect(isOpenAt(entry.intervals, entry.now)).toBe(entry.expectOpen);
    });
  }
});

describe('CustomerStorefrontListQueryDto openNow', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  async function parse(query: Record<string, unknown>) {
    const instance = plainToInstance(CustomerStorefrontListQueryDto, query);
    const errors = await validate(instance);
    if (errors.length > 0) {
      throw errors;
    }
    return pipe.transform(query, {
      type: 'query',
      metatype: CustomerStorefrontListQueryDto,
    }) as Promise<CustomerStorefrontListQueryDto>;
  }

  it('coerces string true/false and rejects truthy garbage', async () => {
    await expect(parse({ openNow: 'true' })).resolves.toMatchObject({
      openNow: true,
    });
    await expect(parse({ openNow: 'false' })).resolves.toMatchObject({
      openNow: false,
    });
    const omitted = await parse({});
    expect(omitted.openNow).toBeUndefined();
    await expect(parse({ openNow: '1' })).rejects.toBeTruthy();
    await expect(parse({ openNow: 'yes' })).rejects.toBeTruthy();
  });
});
