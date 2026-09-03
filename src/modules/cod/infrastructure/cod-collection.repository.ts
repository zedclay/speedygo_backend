import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

export type CodCollectionRecord = {
  id: string;
  orderId: string;
  driverId: string;
  expectedAmountMinor: number;
  collectedAmountMinor: number;
  collectedAt: string;
  status: string;
};

@Injectable()
export class CodCollectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByOrderId(
    orderId: string,
    client?: OrmClient,
  ): Promise<CodCollectionRecord | null> {
    const db = client ?? { orm: this.db().orm };
    const row = await orm(db).CodCollection.where({ orderId }).first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      orderId: row.orderId,
      driverId: row.driverId,
      expectedAmountMinor: parseMinorUnits(row.expectedAmountMinor),
      collectedAmountMinor: parseMinorUnits(row.collectedAmountMinor),
      collectedAt: row.collectedAt,
      status: row.status,
    };
  }
}
