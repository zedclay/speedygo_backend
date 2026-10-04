import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgTimestamptz,
  pgVarchar,
  type PgTimestamptz,
} from '../../../infrastructure/database/pg-values';
import {
  PICKUP_HANDOFF_MAX_ATTEMPTS,
  PICKUP_HANDOFF_STATUS_CONSUMED,
  PICKUP_HANDOFF_STATUS_EXPIRED,
  PICKUP_HANDOFF_STATUS_INVALIDATED,
  PICKUP_HANDOFF_STATUS_LOCKED,
  PICKUP_HANDOFF_STATUS_PENDING,
  type PickupHandoffRecord,
  type PickupHandoffStatus,
} from '../domain/pickup-handoff.types';
import type { OrmClient } from './delivery.repository';

function orm(client: OrmClient) {
  return client.orm.public;
}

@Injectable()
export class PickupHandoffRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findById(
    handoffId: string,
    client?: OrmClient,
  ): Promise<PickupHandoffRecord | null> {
    const row = await orm(client ?? this.db())
      .DeliveryPickupHandoff.where({ id: handoffId })
      .first();
    return row ? this.toRecord(row) : null;
  }

  async findPending(
    deliveryId: string,
    client?: OrmClient,
  ): Promise<PickupHandoffRecord | null> {
    const row = await orm(client ?? this.db())
      .DeliveryPickupHandoff.where({
        deliveryId,
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_PENDING),
      })
      .first();
    return row ? this.toRecord(row) : null;
  }

  /** PENDING or LOCKED challenge for verify (LOCKED must not fall through to legacy). */
  async findVerifiable(
    deliveryId: string,
    client?: OrmClient,
  ): Promise<PickupHandoffRecord | null> {
    const pending = await this.findPending(deliveryId, client);
    if (pending) {
      return pending;
    }
    const locked = await orm(client ?? this.db())
      .DeliveryPickupHandoff.where({
        deliveryId,
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_LOCKED),
      })
      .orderBy((row) => row.createdAt.desc())
      .limit(1)
      .all();
    return locked[0] ? this.toRecord(locked[0]) : null;
  }

  async findConsumedForAssignment(
    deliveryId: string,
    assignmentId: string,
    client?: OrmClient,
  ): Promise<PickupHandoffRecord | null> {
    const row = await orm(client ?? this.db())
      .DeliveryPickupHandoff.where({
        deliveryId,
        assignmentId,
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_CONSUMED),
      })
      .first();
    return row ? this.toRecord(row) : null;
  }

  async insert(
    input: {
      deliveryId: string;
      assignmentId: string;
      assignmentVersion: number;
      codeHash: string;
      codeSealed: string;
      expiresAt: string;
      createdByAccountId: string | null;
    },
    client: OrmClient,
  ): Promise<PickupHandoffRecord> {
    const now = pgNow();
    const created = await orm(client).DeliveryPickupHandoff.create({
      id: createUuidV7(),
      deliveryId: input.deliveryId,
      assignmentId: input.assignmentId,
      assignmentVersion: input.assignmentVersion,
      codeHash: pgVarchar<128>(input.codeHash),
      codeSealed: input.codeSealed,
      status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_PENDING),
      attemptCount: 0,
      maxAttempts: PICKUP_HANDOFF_MAX_ATTEMPTS,
      expiresAt: pgTimestamptz(input.expiresAt),
      lockedUntil: null,
      consumedAt: null,
      consumedByDriverId: null,
      createdByAccountId: input.createdByAccountId,
      invalidatedAt: null,
      invalidatedReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    return this.toRecord(created);
  }

  async invalidatePending(
    deliveryId: string,
    reason: string,
    client: OrmClient,
    occurredAt?: PgTimestamptz,
  ): Promise<number> {
    const now = occurredAt ?? pgNow();
    await orm(client)
      .DeliveryPickupHandoff.where({
        deliveryId,
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_PENDING),
      })
      .update({
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_INVALIDATED),
        invalidatedAt: now,
        invalidatedReason: pgVarchar<64>(reason),
        updatedAt: now,
      });
    const rows = await orm(client)
      .DeliveryPickupHandoff.where({
        deliveryId,
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_INVALIDATED),
        invalidatedReason: pgVarchar<64>(reason),
        invalidatedAt: now,
      })
      .all();
    return rows.length;
  }

  async markExpired(
    handoffId: string,
    client: OrmClient,
    occurredAt?: PgTimestamptz,
  ): Promise<boolean> {
    const now = occurredAt ?? pgNow();
    await orm(client)
      .DeliveryPickupHandoff.where({
        id: handoffId,
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_PENDING),
      })
      .update({
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_EXPIRED),
        updatedAt: now,
      });
    const row = await orm(client)
      .DeliveryPickupHandoff.where({ id: handoffId })
      .first();
    return row?.status === PICKUP_HANDOFF_STATUS_EXPIRED;
  }

  async unlockIfDue(
    handoffId: string,
    client: OrmClient,
    now: Date,
  ): Promise<PickupHandoffRecord | null> {
    const row = await orm(client)
      .DeliveryPickupHandoff.where({ id: handoffId })
      .first();
    if (
      !row ||
      row.status !== PICKUP_HANDOFF_STATUS_LOCKED ||
      !row.lockedUntil ||
      Date.parse(row.lockedUntil) > now.getTime()
    ) {
      return row ? this.toRecord(row) : null;
    }
    const updatedAt = pgTimestamptz(now.toISOString());
    await orm(client)
      .DeliveryPickupHandoff.where({ id: handoffId })
      .update({
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_PENDING),
        lockedUntil: null,
        updatedAt,
      });
    const unlocked = await orm(client)
      .DeliveryPickupHandoff.where({ id: handoffId })
      .first();
    return unlocked ? this.toRecord(unlocked) : null;
  }

  async incrementAttemptsAndMaybeLock(
    handoffId: string,
    client: OrmClient,
    now: Date,
  ): Promise<PickupHandoffRecord | null> {
    const row = await orm(client)
      .DeliveryPickupHandoff.where({ id: handoffId })
      .first();
    if (!row) {
      return null;
    }
    const nextAttempts = row.attemptCount + 1;
    const updatedAt = pgTimestamptz(now.toISOString());
    const shouldLock = nextAttempts >= row.maxAttempts;
    await orm(client)
      .DeliveryPickupHandoff.where({ id: handoffId })
      .update({
        attemptCount: nextAttempts,
        ...(shouldLock
          ? {
              status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_LOCKED),
              lockedUntil: pgTimestamptz(
                new Date(
                  now.getTime() + 15 * 60 * 1000,
                ).toISOString(),
              ),
            }
          : {}),
        updatedAt,
      });
    const updated = await orm(client)
      .DeliveryPickupHandoff.where({ id: handoffId })
      .first();
    return updated ? this.toRecord(updated) : null;
  }

  async consumeConditional(
    input: {
      handoffId: string;
      deliveryId: string;
      assignmentId: string;
      assignmentVersion: number;
      driverId: string;
    },
    client: OrmClient,
    occurredAt?: PgTimestamptz,
  ): Promise<boolean> {
    const now = occurredAt ?? pgNow();
    await orm(client)
      .DeliveryPickupHandoff.where({
        id: input.handoffId,
        deliveryId: input.deliveryId,
        assignmentId: input.assignmentId,
        assignmentVersion: input.assignmentVersion,
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_PENDING),
      })
      .update({
        status: pgVarchar<64>(PICKUP_HANDOFF_STATUS_CONSUMED),
        consumedAt: now,
        consumedByDriverId: input.driverId,
        updatedAt: now,
      });
    const row = await orm(client)
      .DeliveryPickupHandoff.where({ id: input.handoffId })
      .first();
    return Boolean(
      row &&
        row.status === PICKUP_HANDOFF_STATUS_CONSUMED &&
        row.consumedByDriverId === input.driverId,
    );
  }

  private toRecord(row: {
    id: string;
    deliveryId: string;
    assignmentId: string;
    assignmentVersion: number;
    codeHash: string;
    codeSealed: string;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    expiresAt: string;
    lockedUntil: string | null;
    consumedAt: string | null;
    consumedByDriverId: string | null;
    createdByAccountId: string | null;
    invalidatedAt: string | null;
    invalidatedReason: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
  }): PickupHandoffRecord {
    return {
      id: row.id,
      deliveryId: row.deliveryId,
      assignmentId: row.assignmentId,
      assignmentVersion: row.assignmentVersion,
      codeHash: row.codeHash,
      codeSealed: row.codeSealed,
      status: row.status as PickupHandoffStatus,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      expiresAt: row.expiresAt,
      lockedUntil: row.lockedUntil,
      consumedAt: row.consumedAt,
      consumedByDriverId: row.consumedByDriverId,
      createdByAccountId: row.createdByAccountId,
      invalidatedAt: row.invalidatedAt,
      invalidatedReason: row.invalidatedReason,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
