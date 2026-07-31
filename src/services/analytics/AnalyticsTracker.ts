import {
  ANALYTICS_SCHEMA_VERSION,
  APP_VERSION,
  isReferralEventRecord,
} from '../../domain/analytics';
import { stableHash } from '../../domain/referral';

import type {
  AnalyticsClient,
  PlatformName,
  ReferralDiagnosticReason,
  ReferralEventName,
  ReferralEventProperties,
  ReferralEventRecord,
} from '../../domain/analytics';
import type { ReferralStorage } from '../storage/referralStorage';

export type AnalyticsDelivery = 'accepted' | 'duplicate' | 'failed';
export type AnalyticsListener = (event: ReferralEventRecord, delivery: AnalyticsDelivery) => void;

interface TrackOptions {
  once?: boolean;
  attributionKind?: ReferralEventProperties['attribution_kind'];
  reason?: ReferralDiagnosticReason;
  shareChannel?: string;
  isFirstSession?: boolean;
  matchGuaranteed?: boolean;
}

export interface AnalyticsFlushResult {
  accepted: number;
  duplicate: number;
  failed: number;
}

export class AnalyticsTracker {
  private readonly listeners = new Set<AnalyticsListener>();
  private readonly inFlightMilestones = new Map<string, Promise<AnalyticsDelivery>>();
  private attemptSequence = 0;

  constructor(
    private readonly client: AnalyticsClient,
    private readonly storage: ReferralStorage,
    private readonly platform: PlatformName,
    private readonly now: () => Date = () => new Date(),
  ) {}

  subscribe(listener: AnalyticsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async track(
    name: ReferralEventName,
    referralCode: string,
    flowId: string,
    options: TrackOptions = {},
  ): Promise<AnalyticsDelivery> {
    const once = options.once ?? true;
    const milestoneKey = `${flowId}:${name}`;
    this.attemptSequence += 1;
    const eventIdentity = once
      ? milestoneKey
      : `${milestoneKey}:attempt:${this.attemptSequence}`;
    const properties: ReferralEventProperties = {
      referral_code: referralCode,
      platform: this.platform,
      event_id: `evt_${stableHash(eventIdentity)}`,
      flow_id: flowId,
      occurred_at_utc: this.now().toISOString(),
      schema_version: ANALYTICS_SCHEMA_VERSION,
      app_version: APP_VERSION,
      ...(options.attributionKind ? { attribution_kind: options.attributionKind } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.shareChannel ? { share_channel: options.shareChannel } : {}),
      ...(options.isFirstSession !== undefined
        ? { is_first_session: options.isFirstSession }
        : {}),
      ...(options.matchGuaranteed !== undefined
        ? { match_guaranteed: options.matchGuaranteed }
        : {}),
    };
    const event: ReferralEventRecord = { name, properties };

    if (!isReferralEventRecord(event)) {
      this.emit(event, 'failed');
      return 'failed';
    }

    if (!once) return this.deliverBestEffort(event);
    return this.deliverOnce(event, milestoneKey, true);
  }

  async flushPending(): Promise<AnalyticsFlushResult> {
    const result: AnalyticsFlushResult = { accepted: 0, duplicate: 0, failed: 0 };
    let events: ReferralEventRecord[];
    try {
      events = await this.storage.getPendingAnalyticsEvents();
    } catch {
      result.failed += 1;
      return result;
    }

    for (const event of events) {
      const milestoneKey = `${event.properties.flow_id}:${event.name}`;
      const delivery = await this.deliverOnce(event, milestoneKey, false);
      result[delivery] += 1;
    }
    return result;
  }

  private deliverOnce(
    event: ReferralEventRecord,
    milestoneKey: string,
    persistBeforeDelivery: boolean,
  ): Promise<AnalyticsDelivery> {
    const existing = this.inFlightMilestones.get(milestoneKey);
    if (existing) return existing;

    const operation = this.deliverOnceUnlocked(event, milestoneKey, persistBeforeDelivery);
    this.inFlightMilestones.set(milestoneKey, operation);
    void operation.finally(() => {
      if (this.inFlightMilestones.get(milestoneKey) === operation) {
        this.inFlightMilestones.delete(milestoneKey);
      }
    });
    return operation;
  }

  private async deliverOnceUnlocked(
    event: ReferralEventRecord,
    milestoneKey: string,
    persistBeforeDelivery: boolean,
  ): Promise<AnalyticsDelivery> {
    try {
      if (await this.storage.hasMilestone(milestoneKey)) {
        await this.removePendingEventIgnoringFailure(event.properties.event_id);
        this.emit(event, 'duplicate');
        return 'duplicate';
      }
      if (persistBeforeDelivery) await this.storage.savePendingAnalyticsEvent(event);
      await this.client.logEvent(event);
      await this.storage.markMilestone(milestoneKey);
      await this.storage.removePendingAnalyticsEvent(event.properties.event_id);
      this.emit(event, 'accepted');
      return 'accepted';
    } catch {
      this.emit(event, 'failed');
      return 'failed';
    }
  }

  private async deliverBestEffort(event: ReferralEventRecord): Promise<AnalyticsDelivery> {
    try {
      await this.client.logEvent(event);
      this.emit(event, 'accepted');
      return 'accepted';
    } catch {
      this.emit(event, 'failed');
      return 'failed';
    }
  }

  private async removePendingEventIgnoringFailure(eventId: string): Promise<void> {
    try {
      await this.storage.removePendingAnalyticsEvent(eventId);
    } catch {
      // A stale outbox item is safe: the durable milestone suppresses redelivery.
    }
  }

  private emit(event: ReferralEventRecord, delivery: AnalyticsDelivery): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event, delivery);
      } catch {
        // Observers must not change analytics or business delivery semantics.
      }
    });
  }
}
