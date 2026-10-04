import { Queue, QueueEvents, Worker } from 'bullmq';
import {
  MATCHING_RECOVERY_JOB_ID,
  matchingRetryJobId,
  matchingStartJobId,
  matchingTimeoutJobId,
} from '../../../infrastructure/queue/bull-job-id';
import {
  MATCHING_JOB_RECOVERY,
  MATCHING_JOB_RETRY,
  MATCHING_JOB_START,
  MATCHING_JOB_TIMEOUT,
} from '../domain/matching.jobs';
import { MatchingQueueService } from './matching-queue.service';

describe('MatchingQueueService (isolated Redis probe)', () => {
  jest.setTimeout(20_000);
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6381';
  const parsed = new URL(redisUrl);
  const connection = {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null,
  };
  const prefix = 'bull:matching-queue-probe';
  let name: string;
  let queue: Queue;

  const config = (values: Record<string, number>) =>
    ({
      get: (key: string, fallback: number) => values[key] ?? fallback,
    }) as never;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function countRuns(
    jobName: string,
    target: number,
    timeoutMs: number,
  ): Promise<number> {
    let runs = 0;
    const worker = new Worker(
      name,
      (job) => {
        if (job.name === jobName) runs += 1;
        return Promise.resolve();
      },
      { connection, prefix },
    );
    try {
      const deadline = Date.now() + timeoutMs;
      while (runs < target && Date.now() < deadline) {
        await sleep(50);
      }
      return runs;
    } finally {
      await worker.close();
    }
  }

  beforeEach(() => {
    name = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    queue = new Queue(name, { connection, prefix });
  });

  afterEach(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  });

  it('registers recovery as one recurring Job Scheduler that keeps firing', async () => {
    const service = new MatchingQueueService(
      queue,
      config({ 'matching.recoveryIntervalMs': 300 }),
    );
    await service.onModuleInit();
    await service.onModuleInit();

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: MATCHING_RECOVERY_JOB_ID,
      name: MATCHING_JOB_RECOVERY,
      every: 300,
    });

    expect(
      await countRuns(MATCHING_JOB_RECOVERY, 4, 6_000),
    ).toBeGreaterThanOrEqual(4);
  });

  it('survives a restart: re-registration keeps a single scheduler and it keeps firing', async () => {
    const first = new MatchingQueueService(
      queue,
      config({ 'matching.recoveryIntervalMs': 300 }),
    );
    await first.onModuleInit();
    expect(
      await countRuns(MATCHING_JOB_RECOVERY, 2, 4_000),
    ).toBeGreaterThanOrEqual(2);

    const restarted = new MatchingQueueService(
      queue,
      config({ 'matching.recoveryIntervalMs': 400 }),
    );
    await restarted.onModuleInit();
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: MATCHING_RECOVERY_JOB_ID,
      every: 400,
    });
    const pendingRecovery = (
      await queue.getJobs(['waiting', 'delayed', 'prioritized'])
    ).filter((j) => j.name === MATCHING_JOB_RECOVERY);
    expect(pendingRecovery.length).toBeLessThanOrEqual(1);

    expect(
      await countRuns(MATCHING_JOB_RECOVERY, 3, 5_000),
    ).toBeGreaterThanOrEqual(3);
  });

  it('a non-positive interval runs recovery once without a scheduler', async () => {
    const service = new MatchingQueueService(
      queue,
      config({ 'matching.recoveryIntervalMs': 0 }),
    );
    await service.onModuleInit();
    await service.onModuleInit();
    expect(await queue.getJobSchedulers()).toHaveLength(0);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(jobs.filter((j) => j.name === MATCHING_JOB_RECOVERY)).toHaveLength(
      1,
    );
  });

  it('start / timeout / retry keep stable ids, delays and bounded attempts, and deduplicate', async () => {
    const service = new MatchingQueueService(
      queue,
      config({
        'matching.offerTimeoutMs': 30_000,
        'matching.retryDelayMs': 15_000,
      }),
    );
    for (let i = 0; i < 3; i += 1) {
      await service.enqueueStart('order-1');
      await service.enqueueTimeout('asg-1', 25_000);
      await service.enqueueRetry('delivery-1');
    }
    await service.enqueueTimeout('asg-2');

    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    const byName = (n: string) => jobs.filter((j) => j.name === n);
    expect(byName(MATCHING_JOB_START).map((j) => j.id)).toEqual([
      matchingStartJobId('order-1'),
    ]);
    const timeouts = byName(MATCHING_JOB_TIMEOUT);
    expect(timeouts.map((j) => j.id).sort()).toEqual(
      [matchingTimeoutJobId('asg-1'), matchingTimeoutJobId('asg-2')].sort(),
    );
    expect(
      timeouts.find((j) => j.id === matchingTimeoutJobId('asg-1'))?.opts.delay,
    ).toBe(25_000);
    expect(
      timeouts.find((j) => j.id === matchingTimeoutJobId('asg-2'))?.opts.delay,
    ).toBe(30_000);
    const retries = byName(MATCHING_JOB_RETRY);
    expect(retries.map((j) => j.id)).toEqual([
      matchingRetryJobId('delivery-1'),
    ]);
    expect(retries[0].opts.delay).toBe(15_000);
    for (const job of jobs) {
      expect(job.opts.attempts).toBe(5);
      expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
      expect(job.opts).not.toHaveProperty('repeat');
    }
  });

  it('a running retry cannot re-enqueue its own id, so only the recurring sweep resumes an idle search', async () => {
    const service = new MatchingQueueService(
      queue,
      config({ 'matching.retryDelayMs': 0 }),
    );
    await service.enqueueRetry('delivery-idle');
    const events = new QueueEvents(name, { connection, prefix });
    await events.waitUntilReady();
    let processed = 0;
    const worker = new Worker<{ deliveryId: string }>(
      name,
      async (job) => {
        if (job.name !== MATCHING_JOB_RETRY) return;
        processed += 1;
        // Same call MatchingService makes when no Driver is eligible.
        await service.enqueueRetry(String(job.data.deliveryId));
      },
      { connection, prefix },
    );
    try {
      const deadline = Date.now() + 3_000;
      while (processed < 1 && Date.now() < deadline) await sleep(50);
      await sleep(500);
      expect(processed).toBe(1);
      const left = await queue.getJobs([
        'waiting',
        'delayed',
        'prioritized',
        'active',
      ]);
      expect(left.filter((j) => j.name === MATCHING_JOB_RETRY)).toHaveLength(0);
    } finally {
      await worker.close();
      await events.close();
    }
  });
});
