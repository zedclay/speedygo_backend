import { ReadinessService } from './readiness.service';
import {
  ProbeTimeoutError,
  shareUntilSettled,
  withProbeTimeout,
} from './probe-timeout';

describe('ReadinessService', () => {
  const prisma = { ping: jest.fn() };
  const redis = { ping: jest.fn() };

  const service = new ReadinessService(
    prisma as never,
    redis as never,
  );

  beforeEach(() => {
    prisma.ping.mockReset();
    redis.ping.mockReset();
  });

  it('returns ok when postgres and redis are up', async () => {
    prisma.ping.mockResolvedValue('up');
    redis.ping.mockResolvedValue('up');
    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ok',
      service: 'speedygo-backend',
      checks: { postgres: 'up', redis: 'up' },
    });
  });

  it('returns unavailable when postgres is down', async () => {
    prisma.ping.mockResolvedValue('down');
    redis.ping.mockResolvedValue('up');
    await expect(service.getReadiness()).resolves.toEqual({
      status: 'unavailable',
      service: 'speedygo-backend',
      checks: { postgres: 'down', redis: 'up' },
    });
  });

  it('returns unavailable when redis times out', async () => {
    prisma.ping.mockResolvedValue('up');
    redis.ping.mockResolvedValue('timeout');
    await expect(service.getReadiness()).resolves.toEqual({
      status: 'unavailable',
      service: 'speedygo-backend',
      checks: { postgres: 'up', redis: 'timeout' },
    });
  });

  it('does not probe payments or other optional integrations', async () => {
    prisma.ping.mockResolvedValue('up');
    redis.ping.mockResolvedValue('up');
    const body = await service.getReadiness();
    expect(body.checks).toEqual({ postgres: 'up', redis: 'up' });
    expect(JSON.stringify(body)).not.toMatch(/chargily|secret|password|redis:\/\//i);
  });
});

describe('withProbeTimeout', () => {
  it('rejects with ProbeTimeoutError when the probe hangs', async () => {
    await expect(
      withProbeTimeout(new Promise(() => undefined), 20, 'redis'),
    ).rejects.toBeInstanceOf(ProbeTimeoutError);
  });

  it('resolves when the probe finishes first', async () => {
    await expect(
      withProbeTimeout(Promise.resolve('PONG'), 50, 'redis'),
    ).resolves.toBe('PONG');
  });

  it('does not cancel the original command; without sharing each call starts another', async () => {
    let starts = 0;
    const hang = () =>
      new Promise<string>(() => {
        starts += 1;
      });
    await Promise.allSettled([
      withProbeTimeout(hang(), 15, 'redis'),
      withProbeTimeout(hang(), 15, 'redis'),
      withProbeTimeout(hang(), 15, 'redis'),
    ]);
    expect(starts).toBe(3);
  });
});

describe('shareUntilSettled', () => {
  it('starts one hanging command for concurrent timed-out callers', async () => {
    let starts = 0;
    const slot = { current: null as Promise<string> | null };
    const hang = () =>
      new Promise<string>(() => {
        starts += 1;
      });
    await Promise.allSettled([
      withProbeTimeout(shareUntilSettled(slot, hang), 15, 'redis'),
      withProbeTimeout(shareUntilSettled(slot, hang), 15, 'redis'),
      withProbeTimeout(shareUntilSettled(slot, hang), 15, 'redis'),
    ]);
    expect(starts).toBe(1);
    expect(slot.current).not.toBeNull();
  });

  it('reuses the still-pending command after a timeout instead of enqueueing another', async () => {
    let starts = 0;
    const slot = { current: null as Promise<string> | null };
    const hang = () =>
      new Promise<string>(() => {
        starts += 1;
      });
    await expect(
      withProbeTimeout(shareUntilSettled(slot, hang), 15, 'redis'),
    ).rejects.toBeInstanceOf(ProbeTimeoutError);
    await expect(
      withProbeTimeout(shareUntilSettled(slot, hang), 15, 'redis'),
    ).rejects.toBeInstanceOf(ProbeTimeoutError);
    expect(starts).toBe(1);
  });

  it('starts a new command only after the previous one settles', async () => {
    let starts = 0;
    const slot = { current: null as Promise<string> | null };
    await shareUntilSettled(slot, async () => {
      starts += 1;
      return 'PONG';
    });
    await shareUntilSettled(slot, async () => {
      starts += 1;
      return 'PONG';
    });
    expect(starts).toBe(2);
    expect(slot.current).toBeNull();
  });
});
