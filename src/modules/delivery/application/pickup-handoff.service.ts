import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { merchantOrderNotFound } from '../../orders/domain/order.errors';
import {
  ORDER_STATUS_ACTIVE,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
} from '../../orders/domain/order.policy';
import { deliveryNotFound } from '../domain/delivery.errors';
import {
  DELIVERY_STATUS_AT_PICKUP,
  DELIVERY_STATUS_PICKED_UP,
} from '../domain/delivery.policy';
import {
  DRIVER_DELIVERY_ACTION_CONFIRM_PICKUP,
  transitionForAction,
} from '../domain/driver-delivery.policy';
import {
  pickupHandoffAssignmentConflict,
  pickupHandoffCodeInvalid,
  pickupHandoffExpired,
  pickupHandoffInvalidState,
  pickupHandoffLocked,
} from '../domain/pickup-handoff.errors';
import {
  generatePickupHandoffCode,
  hashPickupHandoffCode,
  isPickupHandoffExpired,
  isPickupHandoffLocked,
  pickupHandoffCodeMatches,
  pickupHandoffExpiresAt,
  PICKUP_HANDOFF_STATUS_LOCKED,
  sealPickupHandoffCode,
  toMerchantPickupHandoffView,
  unsealPickupHandoffCode,
  type ConfirmPickupBody,
  type MerchantPickupHandoffView,
  type PickupHandoffRecord,
} from '../domain/pickup-handoff.types';
import {
  DeliveryRepository,
  type OrmClient,
} from '../infrastructure/delivery.repository';
import { PickupHandoffRepository } from '../infrastructure/pickup-handoff.repository';

@Injectable()
export class PickupHandoffService {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly pickupHandoffs: PickupHandoffRepository,
    private readonly merchantAccess: MerchantAccessService,
    private readonly config: ConfigService,
  ) {}

  async getOrIssueForMerchant(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantPickupHandoffView> {
    const context = await this.requireMerchantHandoffContext(
      accountId,
      merchantId,
      orderId,
    );
    const pending = await this.pickupHandoffs.findPending(context.deliveryId);
    if (
      pending &&
      pending.assignmentId === context.assignmentId &&
      pending.assignmentVersion === context.assignmentVersion
    ) {
      return this.toMerchantView(pending);
    }
    return this.deliveries.runInTransaction(async (tx) => {
      await this.deliveries.lockDelivery(context.deliveryId, tx);
      const currentPending = await this.pickupHandoffs.findPending(
        context.deliveryId,
        tx,
      );
      if (
        currentPending &&
        currentPending.assignmentId === context.assignmentId &&
        currentPending.assignmentVersion === context.assignmentVersion
      ) {
        return this.toMerchantView(currentPending);
      }
      if (currentPending) {
        await this.pickupHandoffs.invalidatePending(
          context.deliveryId,
          'ASSIGNMENT_CHANGED',
          tx,
        );
      }
      return this.issuePending(
        {
          deliveryId: context.deliveryId,
          assignmentId: context.assignmentId,
          assignmentVersion: context.assignmentVersion,
          createdByAccountId: accountId,
        },
        tx,
      );
    });
  }

  async regenerateForMerchant(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantPickupHandoffView> {
    const context = await this.requireMerchantHandoffContext(
      accountId,
      merchantId,
      orderId,
    );
    return this.deliveries.runInTransaction(async (tx) => {
      await this.deliveries.lockDelivery(context.deliveryId, tx);
      await this.pickupHandoffs.invalidatePending(
        context.deliveryId,
        'REGENERATED',
        tx,
      );
      return this.issuePending(
        {
          deliveryId: context.deliveryId,
          assignmentId: context.assignmentId,
          assignmentVersion: context.assignmentVersion,
          createdByAccountId: accountId,
        },
        tx,
      );
    });
  }

  async isAlreadyConfirmed(
    deliveryId: string,
    assignmentId: string,
    driverId: string,
  ): Promise<boolean> {
    const delivery = await this.deliveries.findDeliveryById(deliveryId);
    if (!delivery || delivery.status !== DELIVERY_STATUS_PICKED_UP) {
      return false;
    }
    const consumed = await this.pickupHandoffs.findConsumedForAssignment(
      deliveryId,
      assignmentId,
    );
    return Boolean(consumed && consumed.consumedByDriverId === driverId);
  }

  async verifyForConfirmPickup(input: {
    deliveryId: string;
    driverId: string;
    assignmentId: string;
    assignmentVersion: number;
    body?: ConfirmPickupBody;
  }): Promise<'legacy' | 'verified'> {
    const challenge = await this.pickupHandoffs.findVerifiable(input.deliveryId);
    if (!challenge) {
      return 'legacy';
    }
    if (
      challenge.assignmentId !== input.assignmentId ||
      challenge.assignmentVersion !== input.assignmentVersion
    ) {
      throw pickupHandoffAssignmentConflict();
    }
    if (
      !input.body?.pickupCode ||
      !input.body.assignmentId ||
      input.body.assignmentVersion === undefined
    ) {
      throw pickupHandoffCodeInvalid();
    }
    if (
      input.body.assignmentId !== input.assignmentId ||
      input.body.assignmentVersion !== input.assignmentVersion
    ) {
      throw pickupHandoffAssignmentConflict();
    }
    const now = new Date();
    const transition = transitionForAction(DRIVER_DELIVERY_ACTION_CONFIRM_PICKUP);
    type TxOutcome =
      | { kind: 'verified' }
      | {
          kind: 'reject';
          code:
            | 'ASSIGNMENT_CONFLICT'
            | 'EXPIRED'
            | 'LOCKED'
            | 'CODE_INVALID'
            | 'INVALID_STATE';
        };
    // Mutating rejection paths must commit before throwing — Nest/Prisma
    // roll back the transaction when an error is thrown inside it.
    const outcome = await this.deliveries.runInTransaction(
      async (tx): Promise<TxOutcome> => {
        await this.deliveries.lockDelivery(input.deliveryId, tx);
        let handoff = await this.pickupHandoffs.findVerifiable(
          input.deliveryId,
          tx,
        );
        if (
          !handoff ||
          handoff.id !== challenge.id ||
          handoff.assignmentId !== input.assignmentId ||
          handoff.assignmentVersion !== input.assignmentVersion
        ) {
          return { kind: 'reject', code: 'ASSIGNMENT_CONFLICT' };
        }
        if (handoff.status === PICKUP_HANDOFF_STATUS_LOCKED) {
          handoff =
            (await this.pickupHandoffs.unlockIfDue(handoff.id, tx, now)) ??
            handoff;
        }
        if (isPickupHandoffExpired(handoff.expiresAt, now)) {
          await this.pickupHandoffs.markExpired(handoff.id, tx);
          return { kind: 'reject', code: 'EXPIRED' };
        }
        if (
          handoff.status === PICKUP_HANDOFF_STATUS_LOCKED ||
          isPickupHandoffLocked(handoff.lockedUntil, now)
        ) {
          return { kind: 'reject', code: 'LOCKED' };
        }
        if (
          !pickupHandoffCodeMatches(
            this.otpSecret(),
            input.body!.pickupCode!,
            handoff.codeHash,
          )
        ) {
          const updated =
            await this.pickupHandoffs.incrementAttemptsAndMaybeLock(
              handoff.id,
              tx,
              now,
            );
          if (
            updated &&
            (updated.status === PICKUP_HANDOFF_STATUS_LOCKED ||
              isPickupHandoffLocked(updated.lockedUntil, now))
          ) {
            return { kind: 'reject', code: 'LOCKED' };
          }
          return { kind: 'reject', code: 'CODE_INVALID' };
        }
        const consumed = await this.pickupHandoffs.consumeConditional(
          {
            handoffId: handoff.id,
            deliveryId: input.deliveryId,
            assignmentId: input.assignmentId,
            assignmentVersion: input.assignmentVersion,
            driverId: input.driverId,
          },
          tx,
        );
        if (!consumed) {
          return { kind: 'reject', code: 'ASSIGNMENT_CONFLICT' };
        }
        const moved = await this.deliveries.transitionIfStatus(
          {
            deliveryId: input.deliveryId,
            fromStatus: transition.from,
            toStatus: transition.to,
            eventType: transition.eventType,
            driverId: input.driverId,
            pickedUpAt: true,
          },
          tx,
        );
        if (!moved) {
          return { kind: 'reject', code: 'INVALID_STATE' };
        }
        return { kind: 'verified' };
      },
    );
    if (outcome.kind === 'reject') {
      switch (outcome.code) {
        case 'ASSIGNMENT_CONFLICT':
          throw pickupHandoffAssignmentConflict();
        case 'EXPIRED':
          throw pickupHandoffExpired();
        case 'LOCKED':
          throw pickupHandoffLocked();
        case 'INVALID_STATE':
          throw pickupHandoffInvalidState();
        default:
          throw pickupHandoffCodeInvalid();
      }
    }
    return 'verified';
  }

  async invalidateForDelivery(
    deliveryId: string,
    reason: string,
  ): Promise<void> {
    await this.deliveries.runInTransaction(async (tx) => {
      await this.pickupHandoffs.invalidatePending(deliveryId, reason, tx);
    });
  }

  private async requireMerchantHandoffContext(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<{
    deliveryId: string;
    assignmentId: string;
    assignmentVersion: number;
  }> {
    await this.merchantAccess.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
    const order = await this.deliveries.findOrderRecord(orderId);
    if (!order) {
      throw merchantOrderNotFound();
    }
    const owner = await this.deliveries.findBranchMerchantId(
      order.merchantBranchId,
    );
    if (owner !== merchantId) {
      throw merchantOrderNotFound();
    }
    if (
      order.status === ORDER_STATUS_CANCELLED ||
      order.status === ORDER_STATUS_COMPLETED
    ) {
      throw pickupHandoffInvalidState();
    }
    const deliveryId = await this.deliveries.findDeliveryIdByOrderId(orderId);
    if (!deliveryId) {
      throw deliveryNotFound();
    }
    const delivery = await this.deliveries.findDeliveryById(deliveryId);
    if (!delivery || delivery.status !== DELIVERY_STATUS_AT_PICKUP) {
      throw pickupHandoffInvalidState();
    }
    if (order.status !== ORDER_STATUS_ACTIVE) {
      throw pickupHandoffInvalidState();
    }
    const assignment =
      await this.deliveries.findOpenAcceptedAssignmentForDelivery(deliveryId);
    if (!assignment) {
      throw pickupHandoffInvalidState();
    }
    return {
      deliveryId,
      assignmentId: assignment.id,
      assignmentVersion: assignment.version,
    };
  }

  private async issuePending(
    input: {
      deliveryId: string;
      assignmentId: string;
      assignmentVersion: number;
      createdByAccountId: string;
    },
    tx: OrmClient,
  ): Promise<MerchantPickupHandoffView> {
    const code = generatePickupHandoffCode();
    const secret = this.otpSecret();
    const created = await this.pickupHandoffs.insert(
      {
        deliveryId: input.deliveryId,
        assignmentId: input.assignmentId,
        assignmentVersion: input.assignmentVersion,
        codeHash: hashPickupHandoffCode(secret, code),
        codeSealed: sealPickupHandoffCode(secret, code),
        expiresAt: pickupHandoffExpiresAt(new Date()),
        createdByAccountId: input.createdByAccountId,
      },
      tx,
    );
    return toMerchantPickupHandoffView(created, code);
  }

  private toMerchantView(record: PickupHandoffRecord): MerchantPickupHandoffView {
    const pickupCode = unsealPickupHandoffCode(
      this.otpSecret(),
      record.codeSealed,
    );
    return toMerchantPickupHandoffView(record, pickupCode);
  }

  private otpSecret(): string {
    return this.config.get<string>('auth.otpHmacSecret', '');
  }
}
