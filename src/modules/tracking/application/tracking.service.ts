import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../../common/errors/app.error';
import { RedisService } from '../../../infrastructure/cache/redis.service';
import { DeliveryService } from '../../delivery/application/delivery.service';
import { DeliveryRepository } from '../../delivery/infrastructure/delivery.repository';
import { DriverRepository } from '../../drivers/infrastructure/driver.repository';
import { isAcceptedAssignment } from '../../matching/domain/matching.policy';
import { RedisDriverLocationStore } from '../../matching/infrastructure/redis-driver-location.store';
import {
  customerTrackingRoom,
  driverTrackingRoom,
  merchantTrackingRoom,
} from '../domain/tracking.events';
import {
  driverLocationNotAllowed,
  driverLocationRateLimited,
  driverLocationStoreUnavailable,
  trackingAssignmentNotActive,
  trackingUnauthorized,
} from '../domain/tracking.errors';
import {
  canPublishDriverLocation,
  isTrackableDeliveryStatus,
  parseLocationUpdate,
  trackingStatusFor,
} from '../domain/tracking.policy';
import {
  TRACKING_STATUS_LIVE,
  TRACKING_STATUS_NO_DRIVER,
  TRACKING_STATUS_STALE,
  TRACKING_STATUS_UNAVAILABLE,
  type DriverLocationPublishResult,
  type LocationUpdateInput,
  type TrackingLocationView,
  type TrackingSnapshot,
  type TrackingSubscribeResult,
} from '../domain/tracking.types';

@Injectable()
export class TrackingService {
  constructor(
    private readonly locations: RedisDriverLocationStore,
    private readonly drivers: DriverRepository,
    private readonly deliveries: DeliveryService,
    private readonly deliveryRows: DeliveryRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async publishDriverLocation(
    accountId: string,
    input: LocationUpdateInput,
  ): Promise<DriverLocationPublishResult> {
    const parsed = parseLocationUpdate(input);
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverLocationNotAllowed();
    }
    const availability = await this.drivers.findAvailability(profile.id);
    const accepted = await this.drivers.findOpenAcceptedAssignment(profile.id);
    const hasAccepted = Boolean(
      accepted && isAcceptedAssignment(accepted.status, null),
    );
    if (
      !canPublishDriverLocation({
        verificationStatus: profile.verificationStatus,
        availabilityStatus: availability?.status ?? null,
        hasAcceptedAssignment: hasAccepted,
      })
    ) {
      throw driverLocationNotAllowed();
    }
    if (!(await this.consumeRateLimit(profile.id))) {
      throw driverLocationRateLimited();
    }
    const recordedAt = new Date().toISOString();
    const written = await this.writeLocation(
      profile.id,
      parsed.latitude,
      parsed.longitude,
      recordedAt,
      parsed.accuracyMeters,
    );
    let broadcast = false;
    let deliveryId: string | null = null;
    let rooms: string[] = [];
    if (hasAccepted && accepted) {
      const delivery = await this.deliveryRows.findDeliveryById(
        accepted.deliveryId,
      );
      if (delivery && isTrackableDeliveryStatus(delivery.status)) {
        deliveryId = delivery.id;
        broadcast = written.applied;
        if (broadcast) {
          rooms = await this.consumerRooms(delivery.id, profile.id);
        }
      }
    }
    return {
      driverId: profile.id,
      recordedAt: written.record.recordedAt,
      applied: written.applied,
      broadcast,
      deliveryId,
      rooms,
    };
  }

  async subscribeCustomer(
    accountId: string,
    orderId: string,
  ): Promise<TrackingSubscribeResult> {
    const profileId =
      await this.deliveryRows.findProfileIdByAccountId(accountId);
    if (!profileId) {
      throw trackingUnauthorized();
    }
    const snapshot = await this.snapshotForCustomer(accountId, orderId);
    if (!snapshot.deliveryId) {
      throw trackingUnauthorized();
    }
    return {
      snapshot,
      actor: 'customer',
      room: customerTrackingRoom(snapshot.deliveryId, profileId),
    };
  }

  async subscribeMerchant(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<TrackingSubscribeResult> {
    const snapshot = await this.snapshotForMerchant(
      accountId,
      merchantId,
      orderId,
    );
    if (!snapshot.deliveryId) {
      throw trackingUnauthorized();
    }
    return {
      snapshot,
      actor: 'merchant',
      room: merchantTrackingRoom(snapshot.deliveryId, merchantId),
      merchantId,
    };
  }

  async subscribeAssignedDriver(
    accountId: string,
  ): Promise<TrackingSubscribeResult> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw trackingUnauthorized();
    }
    const snapshot = await this.snapshotForAssignedDriver(accountId);
    if (!snapshot.deliveryId) {
      throw trackingAssignmentNotActive();
    }
    return {
      snapshot,
      actor: 'driver',
      room: driverTrackingRoom(snapshot.deliveryId, profile.id),
    };
  }

  async snapshotForCustomer(
    accountId: string,
    orderId: string,
  ): Promise<TrackingSnapshot> {
    const delivery = await this.deliveries.getCustomerDelivery(
      accountId,
      orderId,
    );
    return this.snapshotFromDelivery(
      delivery.id,
      delivery.orderId,
      delivery.status,
      delivery.assignedDriverId,
    );
  }

  async snapshotForMerchant(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<TrackingSnapshot> {
    const delivery = await this.deliveries.getMerchantDelivery(
      accountId,
      merchantId,
      orderId,
    );
    return this.snapshotFromDelivery(
      delivery.id,
      delivery.orderId,
      delivery.status,
      delivery.assignedDriverId,
    );
  }

  async snapshotForAssignedDriver(
    accountId: string,
  ): Promise<TrackingSnapshot> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw trackingUnauthorized();
    }
    const accepted = await this.drivers.findOpenAcceptedAssignment(profile.id);
    if (!accepted || !isAcceptedAssignment(accepted.status, null)) {
      throw trackingAssignmentNotActive();
    }
    const delivery = await this.deliveryRows.findDeliveryById(
      accepted.deliveryId,
    );
    if (!delivery) {
      throw trackingAssignmentNotActive();
    }
    return this.snapshotFromDelivery(
      delivery.id,
      delivery.orderId,
      delivery.status,
      profile.id,
    );
  }

  toBroadcastPayload(snapshot: TrackingSnapshot): TrackingLocationView | null {
    if (snapshot.status !== TRACKING_STATUS_LIVE || !snapshot.location) {
      return null;
    }
    return snapshot.location;
  }

  private async snapshotFromDelivery(
    deliveryId: string,
    orderId: string,
    deliveryStatus: string,
    assignedDriverId: string | null,
  ): Promise<TrackingSnapshot> {
    const accepted = assignedDriverId
      ? await this.drivers.findOpenAcceptedAssignment(assignedDriverId)
      : null;
    const activeDriverId =
      accepted &&
      accepted.deliveryId === deliveryId &&
      isAcceptedAssignment(accepted.status, null)
        ? assignedDriverId
        : null;
    if (!activeDriverId) {
      return {
        deliveryId,
        orderId,
        driverAssigned: false,
        assignedDriverId: null,
        status: TRACKING_STATUS_NO_DRIVER,
        isStale: false,
        location: null,
      };
    }
    if (!isTrackableDeliveryStatus(deliveryStatus)) {
      return {
        deliveryId,
        orderId,
        driverAssigned: true,
        assignedDriverId: activeDriverId,
        status: TRACKING_STATUS_UNAVAILABLE,
        isStale: false,
        location: null,
      };
    }
    const stored = await this.readLocation(activeDriverId);
    if (!stored) {
      return {
        deliveryId,
        orderId,
        driverAssigned: true,
        assignedDriverId: activeDriverId,
        status: TRACKING_STATUS_UNAVAILABLE,
        isStale: false,
        location: null,
      };
    }
    const maxAgeMs = this.config.get<number>(
      'matching.locationMaxAgeMs',
      45_000,
    );
    const status = trackingStatusFor({
      assignedDriverId: activeDriverId,
      recordedAt: stored.recordedAt,
      maxAgeMs,
    });
    const liveLocation: TrackingLocationView | null =
      status === TRACKING_STATUS_LIVE
        ? {
            deliveryId,
            assignedDriverId: activeDriverId,
            latitude: stored.latitude,
            longitude: stored.longitude,
            recordedAt: stored.recordedAt,
            accuracyMeters: null,
          }
        : null;
    return {
      deliveryId,
      orderId,
      driverAssigned: true,
      assignedDriverId: activeDriverId,
      status,
      isStale: status === TRACKING_STATUS_STALE,
      location: liveLocation,
    };
  }

  private async consumerRooms(
    deliveryId: string,
    driverId: string,
  ): Promise<string[]> {
    const delivery = await this.deliveryRows.findDeliveryById(deliveryId);
    if (!delivery) {
      return [driverTrackingRoom(deliveryId, driverId)];
    }
    const order = await this.deliveryRows.findOrderRecord(delivery.orderId);
    if (!order) {
      return [driverTrackingRoom(deliveryId, driverId)];
    }
    const merchantId = await this.deliveryRows.findBranchMerchantId(
      order.merchantBranchId,
    );
    const rooms = [
      customerTrackingRoom(deliveryId, order.customerId),
      driverTrackingRoom(deliveryId, driverId),
    ];
    if (merchantId) {
      rooms.push(merchantTrackingRoom(deliveryId, merchantId));
    }
    return rooms;
  }

  private async writeLocation(
    driverId: string,
    latitude: number,
    longitude: number,
    recordedAt: string,
    accuracyMeters: number | null,
  ) {
    try {
      return await this.locations.upsertIfNewer(
        driverId,
        latitude,
        longitude,
        recordedAt,
        accuracyMeters,
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw driverLocationStoreUnavailable();
    }
  }

  private async readLocation(driverId: string) {
    try {
      return await this.locations.get(driverId);
    } catch {
      throw driverLocationStoreUnavailable();
    }
  }

  private async consumeRateLimit(driverId: string): Promise<boolean> {
    const interval = this.config.get<number>(
      'tracking.minUpdateIntervalMs',
      1000,
    );
    if (interval <= 0) {
      return true;
    }
    const prefix = this.config.get<string>(
      'tracking.redisKeyPrefix',
      'tracking:',
    );
    const key = `${prefix}rate:${driverId}`;
    try {
      const set = await this.redis
        .getClient()
        .set(key, '1', 'PX', interval, 'NX');
      return set === 'OK';
    } catch {
      throw driverLocationStoreUnavailable();
    }
  }
}
