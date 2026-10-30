import {
  Controller,
  Get,
  Header,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of, firstValueFrom } from 'rxjs';
import request from 'supertest';
import { MoneyContractResponseInterceptor } from './money-response.interceptor';
import { MONEY_CONTRACT_V2_DZD } from './money-contract';
import { projectMoneyPayload } from './money-response.projector';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function intercept(
  headers: Record<string, string>,
  data: unknown,
): Promise<unknown> {
  const interceptor = new MoneyContractResponseInterceptor();
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
  const next = { handle: () => of(data) } as CallHandler;
  return firstValueFrom(interceptor.intercept(context, next));
}

describe('MoneyContractResponseInterceptor', () => {
  const money = {
    submittedAmountMinor: '65000',
    totalEarnedMinor: '15000',
  };

  it('reproduces v2 projector cloning StreamableFile into JSON options', () => {
    const file = new StreamableFile(PNG_MAGIC, { type: 'image/png' });
    const cloned = projectMoneyPayload(file, MONEY_CONTRACT_V2_DZD) as {
      options?: unknown;
    };
    expect(cloned).not.toBe(file);
    expect(cloned.options).toBeDefined();
    expect(JSON.stringify(cloned).startsWith('{"options"')).toBe(true);
  });

  it('passes StreamableFile through under dzd-v2 with image headers intact', async () => {
    const file = new StreamableFile(PNG_MAGIC, { type: 'image/png' });
    const out = await intercept(
      { 'x-speedygo-money-contract': 'dzd-v2' },
      file,
    );
    expect(out).toBe(file);
    expect(out).toBeInstanceOf(StreamableFile);
    const streamed = out as StreamableFile;
    expect(streamed.getHeaders().type).toBe('image/png');
    const body: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = streamed.getStream();
      stream.on('data', (chunk: Buffer) => body.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    expect(Buffer.concat(body).equals(PNG_MAGIC)).toBe(true);
  });

  it('passes raw Buffer through under dzd-v2', async () => {
    const out = await intercept(
      { 'x-speedygo-money-contract': 'dzd-v2' },
      PNG_MAGIC,
    );
    expect(out).toBe(PNG_MAGIC);
  });

  it('still adds dzd-v2 JSON money fields without rewriting *Minor', async () => {
    const out = (await intercept(
      { 'x-speedygo-money-contract': 'dzd-v2' },
      money,
    )) as {
      submittedAmountMinor: string;
      submittedAmount: string;
      totalEarned: string;
    };
    expect(out.submittedAmountMinor).toBe('65000');
    expect(out.submittedAmount).toBe('650.00');
    expect(out.totalEarned).toBe('150.00');
  });

  it('leaves v1 JSON money payloads unchanged', async () => {
    const out = await intercept({ accept: 'application/json' }, money);
    expect(out).toEqual(money);
    expect((out as { submittedAmount?: string }).submittedAmount).toBeUndefined();
  });
});

@Controller()
class CoverStubController {
  @Get('cover')
  @Header('Content-Type', 'image/png')
  cover() {
    return new StreamableFile(PNG_MAGIC, { type: 'image/png' });
  }
}

describe('MoneyContractResponseInterceptor HTTP (isolated Nest app)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CoverStubController],
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: MoneyContractResponseInterceptor,
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET image/* keeps PNG bytes and content-type under dzd-v2', async () => {
    const res = await request(app.getHttpServer())
      .get('/cover')
      .set('X-SpeedyGo-Money-Contract', 'dzd-v2')
      .buffer(true)
      .parse((incoming, callback) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/image\/png/i);
    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(body.toString('utf8', 0, 10).startsWith('{"options')).toBe(false);
  });
});
