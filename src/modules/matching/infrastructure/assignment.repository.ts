import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import {
  DELIVERY_STATUS_DRIVER_ASSIGNED,
  DELIVERY_STATUS_SEARCHING_DRIVER,
} from '../../delivery/domain/delivery.policy';
import {
  deliveryAlreadyAssigned,
  driverAlreadyAssigned,
} from '../domain/matching.errors';
import {
  ASSIGNMENT_STATUS_ACCEPTED,
  ASSIGNMENT_STATUS_OFFERED,
  DELIVERY_EVENT_DRIVER_ASSIGNED,
} from '../domain/matching.policy';
import type { AssignmentRecord } from '../domain/matching.types';

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

@Injectable()
export class AssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction((tx) => fn(tx));
  }

  async findById(
    assignmentId: string,
    client?: OrmClient,
  ): Promise<AssignmentRecord | null> {
    const row = await orm(client ?? this.db())
      .DriverAssignment.where({ id: assignmentId })
      .first();
    return row ? this.toAssignment(row) : null;
  }

  async findOpenByDelivery(
    deliveryId: string,
    client?: OrmClient,
  ): Promise<AssignmentRecord | null> {
    const row = await orm(client ?? this.db())
      .DriverAssignment.where({ deliveryId, releasedAt: null })
      .first();
    return row ? this.toAssignment(row) : null;
  }

  async findOpenByDriver(
    driverId: string,
    client?: OrmClient,
  ): Promise<AssignmentRecord | null> {
    const row = await orm(client ?? this.db())
      .DriverAssignment.where({ driverId, releasedAt: null })
      .first();
    return row ? this.toAssignment(row) : null;
  }

  async listDriverIdsForDelivery(
    deliveryId: string,
    client?: OrmClient,
  ): Promise<string[]> {
    const rows = await orm(client ?? this.db())
      .DriverAssignment.where({ deliveryId })
      .all();
    return rows.map((row) => row.driverId);
  }

  async createOffer(
    deliveryId: string,
    driverId: string,
    client: OrmClient,
  ): Promise<AssignmentRecord> {
    const now = pgNow();
    try {
      const created = await orm(client).DriverAssignment.create({
        id: createUuidV7(),
        deliveryId,
        driverId,
        status: pgVarchar<64>(ASSIGNMENT_STATUS_OFFERED),
        assignedAt: now,
        acceptedAt: null,
        releasedAt: null,
      });
      return this.toAssignment(created);
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        const deliveryOpen = await this.findOpenByDelivery(deliveryId, client);
        if (deliveryOpen) {
          throw deliveryAlreadyAssigned();
        }
        throw driverAlreadyAssigned();
      }
      throw error;
    }
  }

  async releaseIfOffered(
    assignmentId: string,
    nextStatus: string,
    client: OrmClient,
  ): Promise<AssignmentRecord | null> {
    const now = pgNow();
    await orm(client)
      .DriverAssignment.where({
        id: assignmentId,
        status: pgVarchar<64>(ASSIGNMENT_STATUS_OFFERED),
        releasedAt: null,
      })
      .update({
        status: pgVarchar<64>(nextStatus),
        releasedAt: now,
      });
    const row = await orm(client)
      .DriverAssignment.where({ id: assignmentId })
      .first();
    if (!row || row.status !== nextStatus || !row.releasedAt) {
      return null;
    }
    return this.toAssignment(row);
  }

  async acceptIfOffered(
    assignmentId: string,
    client: OrmClient,
  ): Promise<AssignmentRecord | null> {
    const now = pgNow();
    await orm(client)
      .DriverAssignment.where({
        id: assignmentId,
        status: pgVarchar<64>(ASSIGNMENT_STATUS_OFFERED),
        releasedAt: null,
      })
      .update({
        status: pgVarchar<64>(ASSIGNMENT_STATUS_ACCEPTED),
        acceptedAt: now,
      });
    const row = await orm(client)
      .DriverAssignment.where({ id: assignmentId })
      .first();
    if (
      !row ||
      row.status !== ASSIGNMENT_STATUS_ACCEPTED ||
      !row.acceptedAt ||
      row.releasedAt
    ) {
      return null;
    }
    return this.toAssignment(row);
  }

  async setDeliveryAssigned(
    deliveryId: string,
    driverId: string,
    client: OrmClient,
  ): Promise<boolean> {
    const now = pgNow();
    await orm(client)
      .Delivery.where({
        id: deliveryId,
        status: DELIVERY_STATUS_SEARCHING_DRIVER,
      })
      .update({
        status: DELIVERY_STATUS_DRIVER_ASSIGNED,
        updatedAt: now,
      });
    const row = await orm(client).Delivery.where({ id: deliveryId }).first();
    if (!row || row.status !== DELIVERY_STATUS_DRIVER_ASSIGNED) {
      return false;
    }
    await orm(client).DeliveryEvent.create({
      id: createUuidV7(),
      deliveryId,
      type: pgVarchar<64>(DELIVERY_EVENT_DRIVER_ASSIGNED),
      driverId,
      occurredAt: now,
      metadataJson: null,
    });
    return true;
  }

  private toAssignment(row: {
    id: string;
    deliveryId: string;
    driverId: string;
    status: string;
    assignedAt: string;
    acceptedAt: string | null;
    releasedAt: string | null;
  }): AssignmentRecord {
    return {
      id: row.id,
      deliveryId: row.deliveryId,
      driverId: row.driverId,
      status: row.status,
      assignedAt: row.assignedAt,
      acceptedAt: row.acceptedAt,
      releasedAt: row.releasedAt,
    };
  }
}
