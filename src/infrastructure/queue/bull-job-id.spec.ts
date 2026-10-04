import { Job, Queue } from 'bullmq';
import {
  MATCHING_RECOVERY_JOB_ID,
  NOTIFICATIONS_RECOVERY_JOB_ID,
  bullCustomJobId,
  matchingRetryJobId,
  matchingStartJobId,
  matchingTimeoutJobId,
} from './bull-job-id';

/** Mirror of BullMQ 6.3 custom jobId colon rule (job.js validateOptions). */
function assertBullMqJobIdAccepted(jobId: string): void {
  if (jobId.includes(':') && jobId.split(':').length !== 3) {
    throw new Error('Custom Id cannot contain :');
  }
}

describe('bullCustomJobId', () => {
  it('joins parts with hyphens and never emits ":"', () => {
    expect(bullCustomJobId('matching', 'recovery')).toBe('matching-recovery');
    expect(bullCustomJobId('notifications', 'recovery')).toBe(
      'notifications-recovery',
    );
    expect(MATCHING_RECOVERY_JOB_ID).toBe('matching-recovery');
    expect(NOTIFICATIONS_RECOVERY_JOB_ID).toBe('notifications-recovery');
  });

  it('preserves UUID hyphens so start/timeout/retry stay unique per entity', () => {
    const orderId = '01a0a2d5-70c9-76a9-8a6d-a6a77b54645d';
    const assignmentId = '01a0a2e5-3998-7967-9ff0-2784e0230783';
    const deliveryId = '01a0a2d6-01e3-70eb-bd30-c3f2b3857ab3';
    expect(matchingStartJobId(orderId)).toBe(`matching-start-${orderId}`);
    expect(matchingTimeoutJobId(assignmentId)).toBe(
      `matching-timeout-${assignmentId}`,
    );
    expect(matchingRetryJobId(deliveryId)).toBe(`matching-retry-${deliveryId}`);
    expect(matchingStartJobId(orderId)).not.toBe(matchingRetryJobId(orderId));
  });

  it('rejects empty parts and embedded colons (collision / BullMQ hazard)', () => {
    expect(() => bullCustomJobId()).toThrow(/at least one/);
    expect(() => bullCustomJobId('matching', '')).toThrow(/non-empty/);
    expect(() => bullCustomJobId('matching', 'start:x')).toThrow(/':'/);
  });

  it('documents BullMQ 6.3 colon rule: 2-segment ids fail, 3-segment legacy ok', () => {
    expect(() => assertBullMqJobIdAccepted('matching:recovery')).toThrow(
      /Custom Id cannot contain :/,
    );
    expect(() => assertBullMqJobIdAccepted('notifications:recovery')).toThrow(
      /Custom Id cannot contain :/,
    );
    expect(() =>
      assertBullMqJobIdAccepted('matching:start:01a0a2d5-70c9'),
    ).not.toThrow();
    for (const jobId of [
      MATCHING_RECOVERY_JOB_ID,
      NOTIFICATIONS_RECOVERY_JOB_ID,
      matchingStartJobId('01a0a2d5-70c9-76a9-8a6d-a6a77b54645d'),
      matchingTimeoutJobId('01a0a2e5-3998-7967-9ff0-2784e0230783'),
      matchingRetryJobId('01a0a2d6-01e3-70eb-bd30-c3f2b3857ab3'),
    ]) {
      expect(() => assertBullMqJobIdAccepted(jobId)).not.toThrow();
      expect(jobId.includes(':')).toBe(false);
    }
  });
});

describe('bullCustomJobId against BullMQ Queue (isolated Redis probe)', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6381';
  let queue: Queue | undefined;

  beforeAll(() => {
    const parsed = new URL(redisUrl);
    queue = new Queue('bull-job-id-probe', {
      connection: {
        host: parsed.hostname,
        port: Number.parseInt(parsed.port || '6379', 10),
        maxRetriesPerRequest: null,
      },
      // Dedicated prefix — does not flush matching/notification queues.
      prefix: 'bull:jobid-probe',
    });
  });

  afterAll(async () => {
    if (!queue) {
      return;
    }
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  });

  it('accepts hyphen recovery/start/timeout/retry jobIds via Queue.add', async () => {
    if (!queue) {
      throw new Error('queue missing');
    }
    const stamp = Date.now().toString();
    const ids = [
      `${MATCHING_RECOVERY_JOB_ID}-probe-${stamp}`,
      matchingStartJobId(`probe-order-${stamp}`),
      matchingTimeoutJobId(`probe-asg-${stamp}`),
      matchingRetryJobId(`probe-del-${stamp}`),
    ];
    for (const jobId of ids) {
      const job = await queue.add('probe', { stamp }, { jobId });
      expect(job.id).toBe(jobId);
      await job.remove();
    }
  });

  it('rejects legacy two-segment colon recovery jobId via Queue.add', async () => {
    if (!queue) {
      throw new Error('queue missing');
    }
    await expect(
      queue.add(
        'probe',
        {},
        { jobId: `matching:recovery:probe-should-fail-${Date.now()}` },
      ),
    ).resolves.toBeTruthy(); // 3 segments — allowed by BullMQ legacy rule
    await expect(
      queue.add('probe', {}, { jobId: `matching:recovery` }),
    ).rejects.toThrow(/Custom Id cannot contain :/);
  });

  it('Job.validateOptions rejects two-segment colon ids', () => {
    const fakeQueue = {
      toKey: (name: string) => name,
      opts: {},
      keys: {},
      qualifiedName: 'q',
    };
    const bad = new Job(
      fakeQueue as never,
      'recovery',
      {},
      { jobId: 'matching:recovery' },
      'matching:recovery',
    );
    expect(() =>
      (bad as unknown as { validateOptions: (d: unknown) => void }).validateOptions(
        { data: '{}' },
      ),
    ).toThrow(/Custom Id cannot contain :/);

    const good = new Job(
      fakeQueue as never,
      'recovery',
      {},
      { jobId: MATCHING_RECOVERY_JOB_ID },
      MATCHING_RECOVERY_JOB_ID,
    );
    expect(() =>
      (
        good as unknown as { validateOptions: (d: unknown) => void }
      ).validateOptions({ data: '{}' }),
    ).not.toThrow();
  });
});
