import { Queue, QueueEvents, Worker } from 'bullmq';
import { NOTIFICATIONS_RECOVERY_JOB_ID } from '../../../infrastructure/queue/bull-job-id';
import { NOTIFICATION_JOB_RECOVERY } from '../domain/notification.jobs';
import { NotificationQueueService } from './notification-queue.service';

describe('NotificationQueueService (isolated Redis probe)', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6381';
  const parsed = new URL(redisUrl);
  const connection = {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null,
  };
  const prefix = 'bull:notif-queue-probe';
  const name = `probe-${Date.now()}`;
  let queue: Queue;

  const config = (values: Record<string, number>) =>
    ({
      get: (key: string, fallback: number) => values[key] ?? fallback,
    }) as never;

  beforeAll(() => {
    queue = new Queue(name, { connection, prefix });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  });

  it('registers the recovery sweep as a recurring Job Scheduler that keeps firing', async () => {
    const service = new NotificationQueueService(
      queue,
      config({ 'notifications.recoveryIntervalMs': 300 }),
    );
    await service.ensureRecoverySchedule();
    await service.ensureRecoverySchedule();

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: NOTIFICATIONS_RECOVERY_JOB_ID,
      name: NOTIFICATION_JOB_RECOVERY,
      every: 300,
    });

    const events = new QueueEvents(name, { connection, prefix });
    await events.waitUntilReady();
    let runs = 0;
    const worker = new Worker(
      name,
      async (job) => {
        if (job.name === NOTIFICATION_JOB_RECOVERY) runs += 1;
      },
      { connection, prefix },
    );
    try {
      const deadline = Date.now() + 5_000;
      while (runs < 3 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(runs).toBeGreaterThanOrEqual(3);
    } finally {
      await worker.close();
      await events.close();
    }
  });

  it('push-send jobs are deduplicated per notification and carry bounded retry', async () => {
    const service = new NotificationQueueService(
      queue,
      config({ 'push.sendMaxAttempts': 4, 'push.sendBackoffMs': 1500 }),
    );
    await service.enqueuePushSend('n-1');
    await service.enqueuePushSend('n-1');
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    const push = jobs.filter((j) => j.name === 'push-send');
    expect(push).toHaveLength(1);
    expect(push[0].opts.attempts).toBe(4);
    expect(push[0].opts.backoff).toEqual({ type: 'exponential', delay: 1500 });
  });
});
