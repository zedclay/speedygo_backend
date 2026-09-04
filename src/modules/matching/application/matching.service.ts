import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryService } from '../../delivery/application/delivery.service';
import {
  DELIVERY_STATUS_CANCELLED,
  DELIVERY_STATUS_DRIVER_ASSIGNED,
  DELIVERY_STATUS_FAILED,
  DELIVERY_STATUS_SEARCHING_DRIVER,
} from '../../delivery/domain/delivery.policy';
import { DeliveryRepository } from '../../delivery/infrastructure/delivery.repository';
import { DriverService } from '../../drivers/application/driver.service';
import {
  DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY,
  DRIVER_AVAILABILITY_ONLINE,
} from '../../drivers/domain/driver.policy';
import { DriverRepository } from '../../drivers/infrastructure/driver.repository';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  deliveryAlreadyAssigned,
  deliveryNotSearchingDriver,
  driverAssignmentExpired,
  driverAssignmentInvalidState,
  driverAssignmentNotFound,
  driverLocationRequired,
  driverLocationStale,
  driverNotMatchingEligible,
  MATCHING_ERROR_CODES,
  MatchingError,
} from '../domain/matching.errors';
import { MATCHING_JOBS, type MatchingJobs } from '../domain/matching.jobs';
import {
  ASSIGNMENT_STATUS_EXPIRED,
  ASSIGNMENT_STATUS_OFFERED,
  ASSIGNMENT_STATUS_REJECTED,
  haversineMeters,
  isAcceptedAssignment,
  isLocationFresh,
  isOfferExpired,
  isOpenOffer,
  isWithinPickupRadius,
  offerExpiresAt,
  rankCandidates,
  roundDistanceMeters,
} from '../domain/matching.policy';
import type {
  AcceptedAssignmentView,
  AssignmentOfferView,
  AssignmentRecord,
  DriverLocationStore,
  MatchingStartResult,
} from '../domain/matching.types';
import { DRIVER_LOCATION_STORE } from '../domain/matching.types';
import { AssignmentRepository } from '../infrastructure/assignment.repository';

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly deliveries: DeliveryService,
    private readonly deliveryRows: DeliveryRepository,
    private readonly drivers: DriverService,
    private readonly driverRows: DriverRepository,
    private readonly assignments: AssignmentRepository,
    private readonly notifications: NotificationService,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    private readonly config: ConfigService,
    @Inject(MATCHING_JOBS) private readonly jobs: MatchingJobs,
  ) {}

  async startForReadyOrder(orderId: string): Promise<MatchingStartResult> {
    const delivery = await this.deliveries.createForReadyOrder(orderId);
    return this.matchDelivery(delivery.id);
  }

  async matchDelivery(deliveryId: string): Promise<MatchingStartResult> {
    await this.expireOpenOfferIfDue(deliveryId);
    const existing = await this.assignments.findOpenByDelivery(deliveryId);
    if (
      existing &&
      isAcceptedAssignment(existing.status, existing.releasedAt)
    ) {
      return {
        deliveryId,
        deliveryStatus: DELIVERY_STATUS_DRIVER_ASSIGNED,
        assignment: existing,
        offered: false,
      };
    }
    if (existing && isOpenOffer(existing.status, existing.releasedAt)) {
      const reused = {
        deliveryId,
        deliveryStatus: DELIVERY_STATUS_SEARCHING_DRIVER,
        assignment: existing,
        offered: true,
      };
      await this.safeSchedule(reused);
      return reused;
    }
    const context = await this.deliveryRows.findMatchingContext(deliveryId);
    if (!context) {
      throw deliveryNotSearchingDriver();
    }
    if (context.deliveryStatus !== DELIVERY_STATUS_SEARCHING_DRIVER) {
      throw deliveryNotSearchingDriver();
    }
    const previous = new Set(
      await this.assignments.listDriverIdsForDelivery(deliveryId),
    );
    const radius = this.config.get<number>('matching.pickupRadiusMeters', 5000);
    const limit = this.config.get<number>('matching.candidateLimit', 20);
    const nearby = await this.locations.searchNear(
      context.pickup.latitude,
      context.pickup.longitude,
      radius,
      limit,
    );
    const ranked = rankCandidates(nearby).filter(
      (candidate) => !previous.has(candidate.driverId),
    );
    const created = await this.assignments.runInTransaction(async (tx) => {
      const locked = await this.deliveryRows.lockDelivery(deliveryId, tx);
      if (!locked || locked.status !== DELIVERY_STATUS_SEARCHING_DRIVER) {
        throw deliveryNotSearchingDriver();
      }
      const openDelivery = await this.assignments.findOpenByDelivery(
        deliveryId,
        tx,
      );
      if (openDelivery) {
        return openDelivery;
      }
      const maxAgeMs = this.config.get<number>(
        'matching.locationMaxAgeMs',
        45_000,
      );
      for (const candidate of ranked) {
        if (!isWithinPickupRadius(candidate.distanceMeters, radius)) {
          continue;
        }
        const location = await this.locations.get(candidate.driverId);
        if (!location || !isLocationFresh(location.recordedAt, maxAgeMs)) {
          continue;
        }
        if (!(await this.isMatchable(candidate.driverId))) {
          continue;
        }
        const profile = await this.driverRows.lockProfile(
          candidate.driverId,
          tx,
        );
        if (!profile) {
          continue;
        }
        const openDriver = await this.assignments.findOpenByDriver(
          candidate.driverId,
          tx,
        );
        if (openDriver) {
          continue;
        }
        try {
          return await this.assignments.createOffer(
            deliveryId,
            candidate.driverId,
            tx,
          );
        } catch (error) {
          if (
            error instanceof MatchingError &&
            error.code === MATCHING_ERROR_CODES.DRIVER_ALREADY_ASSIGNED
          ) {
            continue;
          }
          if (
            error instanceof MatchingError &&
            error.code === MATCHING_ERROR_CODES.DELIVERY_ALREADY_ASSIGNED
          ) {
            const existingOpen = await this.assignments.findOpenByDelivery(
              deliveryId,
              tx,
            );
            if (existingOpen) {
              return existingOpen;
            }
          }
          throw error;
        }
      }
      return null;
    });
    if (!created) {
      const idle = {
        deliveryId,
        deliveryStatus: DELIVERY_STATUS_SEARCHING_DRIVER,
        assignment: null,
        offered: false,
      };
      await this.safeSchedule(idle);
      return idle;
    }
    const offered = {
      deliveryId,
      deliveryStatus: DELIVERY_STATUS_SEARCHING_DRIVER,
      assignment: created,
      offered: created.status === ASSIGNMENT_STATUS_OFFERED,
    };
    await this.safeSchedule(offered);
    if (offered.offered && created) {
      await this.notifications.notifyMatchOffer({
        assignmentId: created.id,
        driverId: created.driverId,
      });
    }
    return offered;
  }

  async getCurrentOffer(
    accountId: string,
  ): Promise<AssignmentOfferView | null> {
    const profile = await this.driverRows.findProfileByAccountId(accountId);
    if (!profile) {
      return null;
    }
    await this.expireOpenOfferForDriverIfDue(profile.id);
    const open = await this.assignments.findOpenByDriver(profile.id);
    if (!open || !isOpenOffer(open.status, open.releasedAt)) {
      return null;
    }
    return this.toOfferView(open);
  }

  async getAcceptedAssignment(
    accountId: string,
  ): Promise<AcceptedAssignmentView | null> {
    const profile = await this.driverRows.findProfileByAccountId(accountId);
    if (!profile) {
      return null;
    }
    const open = await this.assignments.findOpenByDriver(profile.id);
    if (!open || !isAcceptedAssignment(open.status, open.releasedAt)) {
      return null;
    }
    return this.toAcceptedView(open);
  }

  async accept(
    accountId: string,
    assignmentId: string,
  ): Promise<AcceptedAssignmentView> {
    const profile = await this.requireDriver(accountId);
    await this.expireAssignmentIfDue(assignmentId);
    const accepted = await this.assignments.runInTransaction(async (tx) => {
      const assignment = await this.assignments.findById(assignmentId, tx);
      if (!assignment || assignment.driverId !== profile.id) {
        throw driverAssignmentNotFound();
      }
      const delivery = await this.deliveryRows.lockDelivery(
        assignment.deliveryId,
        tx,
      );
      if (!delivery) {
        throw deliveryNotSearchingDriver();
      }
      await this.driverRows.lockProfile(profile.id, tx);
      const current = await this.assignments.findById(assignmentId, tx);
      if (!current || current.driverId !== profile.id) {
        throw driverAssignmentNotFound();
      }
      this.assertOfferAcceptable(current, delivery.status);
      await this.assertAcceptEligibility(profile.id);
      const moved = await this.assignments.acceptIfOffered(assignmentId, tx);
      if (!moved) {
        throw driverAssignmentInvalidState();
      }
      const assigned = await this.assignments.setDeliveryAssigned(
        assignment.deliveryId,
        profile.id,
        tx,
      );
      if (!assigned) {
        throw deliveryAlreadyAssigned();
      }
      return moved;
    });
    const context = await this.deliveryRows.findMatchingContext(
      accepted.deliveryId,
    );
    if (context) {
      await this.notifications.notifyDriverAssigned({
        orderId: context.orderId,
        customerId: context.customerId,
        publicReference: context.publicReference,
      });
    }
    return this.toAcceptedView(accepted);
  }

  async reject(
    accountId: string,
    assignmentId: string,
  ): Promise<MatchingStartResult> {
    const profile = await this.requireDriver(accountId);
    await this.expireAssignmentIfDue(assignmentId);
    const deliveryId = await this.assignments.runInTransaction(async (tx) => {
      const assignment = await this.assignments.findById(assignmentId, tx);
      if (!assignment || assignment.driverId !== profile.id) {
        throw driverAssignmentNotFound();
      }
      await this.deliveryRows.lockDelivery(assignment.deliveryId, tx);
      const current = await this.assignments.findById(assignmentId, tx);
      if (!current || current.driverId !== profile.id) {
        throw driverAssignmentNotFound();
      }
      if (!isOpenOffer(current.status, current.releasedAt)) {
        throw driverAssignmentInvalidState();
      }
      const released = await this.assignments.releaseIfOffered(
        assignmentId,
        ASSIGNMENT_STATUS_REJECTED,
        tx,
      );
      if (!released) {
        throw driverAssignmentInvalidState();
      }
      return assignment.deliveryId;
    });
    return this.matchDelivery(deliveryId);
  }

  async expireOffer(assignmentId: string): Promise<AssignmentRecord | null> {
    const assignment = await this.assignments.findById(assignmentId);
    if (!assignment) {
      return null;
    }
    if (!isOpenOffer(assignment.status, assignment.releasedAt)) {
      return assignment;
    }
    if (
      !isOfferExpired(
        assignment.assignedAt,
        this.config.get<number>('matching.offerTimeoutMs', 30_000),
      )
    ) {
      return assignment;
    }
    const expired = await this.assignments.runInTransaction(async (tx) => {
      await this.deliveryRows.lockDelivery(assignment.deliveryId, tx);
      return this.assignments.releaseIfOffered(
        assignmentId,
        ASSIGNMENT_STATUS_EXPIRED,
        tx,
      );
    });
    return expired ?? (await this.assignments.findById(assignmentId));
  }

  async expireAndContinue(
    assignmentId: string,
  ): Promise<MatchingStartResult | null> {
    const before = await this.assignments.findById(assignmentId);
    if (!before || !isOpenOffer(before.status, before.releasedAt)) {
      return null;
    }
    const expired = await this.assignments.runInTransaction(async (tx) => {
      await this.deliveryRows.lockDelivery(before.deliveryId, tx);
      return this.assignments.releaseIfOffered(
        assignmentId,
        ASSIGNMENT_STATUS_EXPIRED,
        tx,
      );
    });
    if (!expired || expired.status !== ASSIGNMENT_STATUS_EXPIRED) {
      return null;
    }
    return this.matchDelivery(expired.deliveryId);
  }

  private async expireOpenOfferIfDue(deliveryId: string): Promise<void> {
    const open = await this.assignments.findOpenByDelivery(deliveryId);
    if (open && isOpenOffer(open.status, open.releasedAt)) {
      await this.expireOffer(open.id);
    }
  }

  private async expireOpenOfferForDriverIfDue(driverId: string): Promise<void> {
    const open = await this.assignments.findOpenByDriver(driverId);
    if (open && isOpenOffer(open.status, open.releasedAt)) {
      await this.expireOffer(open.id);
    }
  }

  private async expireAssignmentIfDue(assignmentId: string): Promise<void> {
    await this.expireOffer(assignmentId);
  }

  private async requireDriver(accountId: string) {
    const profile = await this.driverRows.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverAssignmentNotFound();
    }
    return profile;
  }

  private assertOfferAcceptable(
    assignment: AssignmentRecord,
    deliveryStatus: string,
  ): void {
    if (
      isOfferExpired(
        assignment.assignedAt,
        this.config.get<number>('matching.offerTimeoutMs', 30_000),
      )
    ) {
      throw driverAssignmentExpired();
    }
    if (!isOpenOffer(assignment.status, assignment.releasedAt)) {
      throw driverAssignmentInvalidState();
    }
    if (deliveryStatus !== DELIVERY_STATUS_SEARCHING_DRIVER) {
      if (
        deliveryStatus === DELIVERY_STATUS_CANCELLED ||
        deliveryStatus === DELIVERY_STATUS_FAILED
      ) {
        throw deliveryNotSearchingDriver();
      }
      throw deliveryAlreadyAssigned();
    }
  }

  private async assertAcceptEligibility(driverId: string): Promise<void> {
    if (!(await this.drivers.matchingEligibility(driverId))) {
      throw driverNotMatchingEligible();
    }
    const availability = await this.driverRows.findAvailability(driverId);
    if (
      availability?.status ===
      DRIVER_AVAILABILITY_OFFLINE_AFTER_CURRENT_DELIVERY
    ) {
      throw driverNotMatchingEligible();
    }
    const maxAgeMs = this.config.get<number>(
      'matching.locationMaxAgeMs',
      45_000,
    );
    const location = await this.locations.get(driverId);
    if (!location) {
      throw driverLocationRequired();
    }
    if (!isLocationFresh(location.recordedAt, maxAgeMs)) {
      throw driverLocationStale();
    }
  }

  private async isMatchable(driverId: string): Promise<boolean> {
    if (!(await this.drivers.matchingEligibility(driverId))) {
      return false;
    }
    const availability = await this.driverRows.findAvailability(driverId);
    if (!availability || availability.status !== DRIVER_AVAILABILITY_ONLINE) {
      return false;
    }
    const open = await this.assignments.findOpenByDriver(driverId);
    return !open;
  }

  private async toOfferView(
    assignment: AssignmentRecord,
  ): Promise<AssignmentOfferView> {
    const context = await this.requireContext(assignment.deliveryId);
    const location = await this.locations.get(assignment.driverId);
    const pickupDistance = location
      ? haversineMeters(
          location.latitude,
          location.longitude,
          context.pickup.latitude,
          context.pickup.longitude,
        )
      : 0;
    const deliveryDistance = location
      ? haversineMeters(
          location.latitude,
          location.longitude,
          context.dropoff.latitude,
          context.dropoff.longitude,
        )
      : null;
    return {
      assignmentId: assignment.id,
      deliveryId: assignment.deliveryId,
      orderPublicReference: context.publicReference,
      status: assignment.status,
      offeredAt: assignment.assignedAt,
      expiresAt: offerExpiresAt(
        assignment.assignedAt,
        this.config.get<number>('matching.offerTimeoutMs', 30_000),
      ),
      driverRemunerationMinor: context.driverRemunerationMinor,
      pickup: { name: context.pickup.name },
      pickupDistanceMeters: roundDistanceMeters(pickupDistance),
      deliveryDistanceMeters:
        deliveryDistance === null
          ? null
          : roundDistanceMeters(deliveryDistance),
    };
  }

  private async toAcceptedView(
    assignment: AssignmentRecord,
  ): Promise<AcceptedAssignmentView> {
    const context = await this.requireContext(assignment.deliveryId);
    return {
      assignmentId: assignment.id,
      deliveryId: assignment.deliveryId,
      orderPublicReference: context.publicReference,
      status: assignment.status,
      acceptedAt: assignment.acceptedAt,
      driverRemunerationMinor: context.driverRemunerationMinor,
      pickup: {
        name: context.pickup.name,
        addressText: context.pickup.addressText,
        latitude: context.pickup.latitude,
        longitude: context.pickup.longitude,
      },
      dropoff: {
        addressText: context.dropoff.addressText,
        latitude: context.dropoff.latitude,
        longitude: context.dropoff.longitude,
      },
    };
  }

  private async requireContext(deliveryId: string) {
    const context = await this.deliveryRows.findMatchingContext(deliveryId);
    if (!context) {
      throw driverAssignmentNotFound();
    }
    return context;
  }

  private async safeSchedule(result: MatchingStartResult): Promise<void> {
    try {
      await this.jobs.scheduleAfterMatch(result);
    } catch (error) {
      this.logger.warn(
        `Matching follow-up enqueue failed for delivery ${result.deliveryId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
