import { Injectable } from '@nestjs/common';
import { type SpeedyGoDb } from '../../../infrastructure/database/database.module';
import { deliveryZoneNotFound } from '../domain/delivery-pricing.errors';
import type {
  CreateDeliveryZoneInput,
  DeliveryZoneRecord,
  UpdateDeliveryZoneInput,
} from '../domain/delivery-pricing.types';
import { DeliveryZoneRepository } from '../infrastructure/delivery-zone.repository';

/** Minimal client compatible with transaction callback (ORM + optional raw query). */
type ZoneTxClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

export type ZoneMutationResult = {
  zone: DeliveryZoneRecord;
  mutated: boolean;
};

@Injectable()
export class DeliveryZoneService {
  constructor(private readonly zones: DeliveryZoneRepository) {}

  /**
   * Create starts inactive. Interior-overlap is not checked until activation
   * so inactive drafts may coexist under an active neighbour.
   */
  async createZoneInTx(
    tx: ZoneTxClient,
    input: CreateDeliveryZoneInput,
  ): Promise<DeliveryZoneRecord> {
    await this.zones.requireSpatialValid(input.polygon);
    return this.zones.create(
      { name: input.name, polygon: input.polygon, active: false },
      tx,
    );
  }

  async updateZoneInTx(
    tx: ZoneTxClient,
    input: UpdateDeliveryZoneInput,
  ): Promise<ZoneMutationResult> {
    const exists = await this.zones.findByIdORM(input.id, tx);
    if (!exists) {
      throw deliveryZoneNotFound();
    }

    const nameUnchanged =
      input.name === undefined || input.name === exists.name;
    const geometryUnchanged = input.polygon === undefined;
    if (nameUnchanged && geometryUnchanged) {
      const full = await this.zones.findById(input.id);
      return {
        zone: full ?? (await this.zones.requireById(input.id)),
        mutated: false,
      };
    }

    if (input.polygon !== undefined) {
      await this.zones.requireSpatialValid(input.polygon);
      if (exists.active) {
        await this.zones.lockActiveZoneTopology(tx);
        await this.zones.requireNoActiveInteriorOverlap(
          input.polygon,
          input.id,
        );
      }
    } else if (exists.active) {
      await this.zones.lockActiveZoneTopology(tx);
    }

    const zone = await this.zones.update(
      input.id,
      { name: input.name, polygon: input.polygon },
      tx,
    );
    return { zone, mutated: true };
  }

  async activateZoneInTx(
    tx: ZoneTxClient,
    zoneId: string,
  ): Promise<ZoneMutationResult> {
    await this.zones.lockActiveZoneTopology(tx);
    const zone = await this.zones.findByIdORM(zoneId, tx);
    if (!zone) {
      throw deliveryZoneNotFound();
    }
    if (zone.active) {
      const full = await this.zones.findById(zoneId);
      return {
        zone: full ?? (await this.zones.requireById(zoneId)),
        mutated: false,
      };
    }
    await this.zones.requireNoActiveInteriorOverlapForStoredZone(zoneId);
    const updated = await this.zones.setActive(zoneId, true, tx);
    return { zone: updated, mutated: true };
  }

  async deactivateZoneInTx(
    tx: ZoneTxClient,
    zoneId: string,
  ): Promise<ZoneMutationResult> {
    await this.zones.lockActiveZoneTopology(tx);
    const zone = await this.zones.findByIdORM(zoneId, tx);
    if (!zone) {
      throw deliveryZoneNotFound();
    }
    if (!zone.active) {
      const full = await this.zones.findById(zoneId);
      return {
        zone: full ?? (await this.zones.requireById(zoneId)),
        mutated: false,
      };
    }
    const updated = await this.zones.setActive(zoneId, false, tx);
    return { zone: updated, mutated: true };
  }
}
