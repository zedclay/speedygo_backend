import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pgNow } from '../../../infrastructure/database/pg-values';
import { DriverRepository } from '../../drivers/infrastructure/driver.repository';
import { CodCollectionRepository } from '../../cod/infrastructure/cod-collection.repository';
import {
  COD_COLLECTION_STATUS_COLLECTED,
  COD_CURRENCY_DZD,
} from '../../cod/domain/cod.policy';
import {
  DRIVER_AVAILABILITY_OFFLINE,
  DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY,
} from '../../drivers/domain/driver.policy';
import { isAcceptedAssignment } from '../../matching/domain/matching.policy';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../../matching/domain/matching.types';
import {
  ORDER_PAYMENT_METHOD_COD,
  ORDER_PAYMENT_METHOD_ELECTRONIC,
  ORDER_STATUS_ACTIVE,
  PAYMENT_STATUS_SUCCEEDED,
} from '../../orders/domain/order.policy';
import {
  driverDeliveryActionNotAllowed,
  driverDeliveryAssignmentNotActive,
  driverDeliveryCodCompletionNotReady,
  driverDeliveryInvalidState,
  driverDeliveryLocationRequired,
  driverDeliveryLocationStale,
  driverDeliveryNotFound,
  driverDeliveryNotNearDropoff,
  driverDeliveryNotNearPickup,
  driverDeliveryPaymentNotReady,
} from '../domain/driver-delivery.errors';
import {
  actionRequiresArrivalLocation,
  allowedActionsForStatus,
  decideArrivalLocation,
  DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER,
  DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP,
  DRIVER_DELIVERY_ACTION_COMPLETE_DELIVERY,
  DRIVER_DELIVERY_DROPOFF_RADIUS_METERS,
  DRIVER_DELIVERY_PICKUP_RADIUS_METERS,
  transitionForAction,
  type DriverDeliveryAction,
} from '../domain/driver-delivery.policy';
import { DeliveryRepository } from '../infrastructure/delivery.repository';

export type DriverCurrentDeliveryView = {
  assignmentId: string;
  deliveryId: string;
  orderId: string;
  deliveryStatus: string;
  orderStatus: string;
  fulfillmentStatus: string;
  assignmentStatus: string;
  allowedActions: DriverDeliveryAction[];
  pickedUpAt: string | null;
  arrivedCustomerAt: string | null;
  deliveredAt: string | null;
};

@Injectable()
export class DriverDeliveryService {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    private readonly config: ConfigService,
    private readonly codCollections: CodCollectionRepository,
  ) {}

  async getCurrent(
    accountId: string,
  ): Promise<DriverCurrentDeliveryView | null> {
    const context = await this.resolveActiveAssignment(accountId, false);
    if (!context) {
      return null;
    }
    const detail = await this.deliveries.findDeliveryDetail(context.orderId);
    if (!detail) {
      return null;
    }
    return {
      assignmentId: context.assignmentId,
      deliveryId: context.deliveryId,
      orderId: context.orderId,
      deliveryStatus: detail.status,
      orderStatus: detail.orderStatus,
      fulfillmentStatus: detail.fulfillmentStatus,
      assignmentStatus: context.assignmentStatus,
      allowedActions: allowedActionsForStatus(detail.status),
      pickedUpAt: detail.pickedUpAt,
      arrivedCustomerAt: detail.arrivedCustomerAt,
      deliveredAt: detail.deliveredAt,
    };
  }

  async performAction(
    accountId: string,
    action: DriverDeliveryAction,
  ): Promise<DriverCurrentDeliveryView> {
    const context = await this.resolveActiveAssignment(accountId, true);
    if (!context) {
      throw driverDeliveryAssignmentNotActive();
    }
    const transition = transitionForAction(action);
    if (action === DRIVER_DELIVERY_ACTION_COMPLETE_DELIVERY) {
      return this.completeDelivery(context, transition);
    }
    const moved = await this.deliveries.runInTransaction(async (tx) => {
      const locked = await this.deliveries.lockDelivery(context.deliveryId, tx);
      if (!locked) {
        throw driverDeliveryNotFound();
      }
      const accepted = await this.drivers.findOpenAcceptedAssignment(
        context.driverId,
        tx,
      );
      if (
        !accepted ||
        accepted.deliveryId !== context.deliveryId ||
        !isAcceptedAssignment(accepted.status, null)
      ) {
        throw driverDeliveryAssignmentNotActive();
      }
      if (locked.status !== transition.from) {
        throw driverDeliveryInvalidState();
      }
      if (actionRequiresArrivalLocation(action)) {
        await this.assertArrivalProximity(
          action,
          context.deliveryId,
          context.orderId,
          context.driverId,
        );
      }
      return this.deliveries.transitionIfStatus(
        {
          deliveryId: context.deliveryId,
          fromStatus: transition.from,
          toStatus: transition.to,
          eventType: transition.eventType,
          driverId: context.driverId,
          pickedUpAt: transition.timestampField === 'pickedUpAt',
          arrivedCustomerAt: transition.timestampField === 'arrivedCustomerAt',
        },
        tx,
      );
    });
    if (!moved) {
      throw driverDeliveryInvalidState();
    }
    const current = await this.getCurrent(accountId);
    if (!current) {
      throw driverDeliveryNotFound();
    }
    return current;
  }

  private async completeDelivery(
    context: {
      driverId: string;
      assignmentId: string;
      deliveryId: string;
      orderId: string;
    },
    transition: ReturnType<typeof transitionForAction>,
  ): Promise<DriverCurrentDeliveryView> {
    await this.deliveries.runInTransaction(async (tx) => {
      const locked = await this.deliveries.lockDelivery(context.deliveryId, tx);
      if (!locked) {
        throw driverDeliveryNotFound();
      }
      const accepted = await this.drivers.findOpenAcceptedAssignment(
        context.driverId,
        tx,
      );
      if (
        !accepted ||
        accepted.id !== context.assignmentId ||
        !isAcceptedAssignment(accepted.status, null)
      ) {
        throw driverDeliveryAssignmentNotActive();
      }
      if (locked.status !== transition.from) {
        throw driverDeliveryInvalidState();
      }
      const order = await this.deliveries.lockOrder(context.orderId, tx);
      if (!order || order.status !== ORDER_STATUS_ACTIVE) {
        throw driverDeliveryInvalidState();
      }
      const payment = await this.deliveries.lockPayment(context.orderId, tx);
      if (!payment) {
        throw driverDeliveryPaymentNotReady();
      }
      if (payment.method === ORDER_PAYMENT_METHOD_COD) {
        const collection = await this.codCollections.findByOrderId(
          context.orderId,
          tx,
        );
        const snapshot = await this.deliveries.findSnapshotCustomerPayable(
          context.orderId,
          tx,
        );
        if (
          !collection ||
          !snapshot ||
          snapshot.currency !== COD_CURRENCY_DZD ||
          collection.status !== COD_COLLECTION_STATUS_COLLECTED ||
          payment.status !== PAYMENT_STATUS_SUCCEEDED ||
          collection.driverId !== context.driverId ||
          collection.collectedAmountMinor !== collection.expectedAmountMinor ||
          collection.collectedAmountMinor !== payment.amountMinor ||
          collection.collectedAmountMinor !== snapshot.customerPayableMinor
        ) {
          throw driverDeliveryCodCompletionNotReady();
        }
      } else if (
        payment.method !== ORDER_PAYMENT_METHOD_ELECTRONIC ||
        payment.status !== PAYMENT_STATUS_SUCCEEDED
      ) {
        throw driverDeliveryPaymentNotReady();
      }
      const now = pgNow();
      const moved = await this.deliveries.transitionIfStatus(
        {
          deliveryId: context.deliveryId,
          fromStatus: transition.from,
          toStatus: transition.to,
          eventType: transition.eventType,
          driverId: context.driverId,
          deliveredAt: true,
          occurredAt: now,
        },
        tx,
      );
      if (!moved) {
        throw driverDeliveryInvalidState();
      }
      const released = await this.deliveries.releaseAcceptedAssignment(
        context.assignmentId,
        tx,
        now,
      );
      if (!released) {
        throw driverDeliveryAssignmentNotActive();
      }
      const completed = await this.deliveries.completeActiveOrder(
        context.orderId,
        context.driverId,
        tx,
        now,
      );
      if (!completed) {
        throw driverDeliveryInvalidState();
      }
      const availability = await this.drivers.findAvailability(
        context.driverId,
        tx,
      );
      if (
        availability?.status ===
        DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY
      ) {
        await this.drivers.setAvailabilityStatus(
          context.driverId,
          DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY,
          DRIVER_AVAILABILITY_OFFLINE,
          tx,
        );
      }
    });
    const detail = await this.deliveries.findDeliveryDetail(context.orderId);
    if (!detail) {
      throw driverDeliveryNotFound();
    }
    return {
      assignmentId: context.assignmentId,
      deliveryId: context.deliveryId,
      orderId: context.orderId,
      deliveryStatus: detail.status,
      orderStatus: detail.orderStatus,
      fulfillmentStatus: detail.fulfillmentStatus,
      assignmentStatus: 'RELEASED',
      allowedActions: [],
      pickedUpAt: detail.pickedUpAt,
      arrivedCustomerAt: detail.arrivedCustomerAt,
      deliveredAt: detail.deliveredAt,
    };
  }

  private async assertArrivalProximity(
    action: DriverDeliveryAction,
    deliveryId: string,
    orderId: string,
    driverId: string,
  ): Promise<void> {
    const matching = await this.deliveries.findMatchingContext(deliveryId);
    const fallback = matching
      ? null
      : await this.deliveries.findDeliveryDetail(orderId);
    const target = matching
      ? action === DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP
        ? matching.pickup
        : matching.dropoff
      : fallback
        ? action === DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP
          ? fallback.pickup
          : fallback.dropoff
        : null;
    if (!target) {
      throw driverDeliveryNotFound();
    }
    const radiusMeters = this.config.get<number>(
      action === DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP
        ? 'driverDelivery.pickupRadiusMeters'
        : 'driverDelivery.dropoffRadiusMeters',
      action === DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP
        ? DRIVER_DELIVERY_PICKUP_RADIUS_METERS
        : DRIVER_DELIVERY_DROPOFF_RADIUS_METERS,
    );
    const maxAgeMs = this.config.get<number>(
      'matching.locationMaxAgeMs',
      45_000,
    );
    const location = await this.locations.get(driverId);
    const decision = decideArrivalLocation({
      location,
      targetLatitude: target.latitude,
      targetLongitude: target.longitude,
      maxAgeMs,
      radiusMeters,
    });
    if (decision === 'missing') {
      throw driverDeliveryLocationRequired();
    }
    if (decision === 'stale') {
      throw driverDeliveryLocationStale();
    }
    if (decision === 'too_far') {
      throw action === DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER
        ? driverDeliveryNotNearDropoff()
        : driverDeliveryNotNearPickup();
    }
  }

  private async resolveActiveAssignment(
    accountId: string,
    required: boolean,
  ): Promise<{
    driverId: string;
    assignmentId: string;
    deliveryId: string;
    orderId: string;
    assignmentStatus: string;
  } | null> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      if (required) {
        throw driverDeliveryActionNotAllowed();
      }
      return null;
    }
    const accepted = await this.drivers.findOpenAcceptedAssignment(profile.id);
    if (!accepted || !isAcceptedAssignment(accepted.status, null)) {
      if (required) {
        throw driverDeliveryAssignmentNotActive();
      }
      return null;
    }
    const delivery = await this.deliveries.findDeliveryById(
      accepted.deliveryId,
    );
    if (!delivery) {
      if (required) {
        throw driverDeliveryNotFound();
      }
      return null;
    }
    return {
      driverId: profile.id,
      assignmentId: accepted.id,
      deliveryId: delivery.id,
      orderId: delivery.orderId,
      assignmentStatus: accepted.status,
    };
  }
}
