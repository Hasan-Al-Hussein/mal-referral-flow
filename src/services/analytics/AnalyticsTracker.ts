import { ANALYTICS_SCHEMA_VERSION, APP_VERSION } from '../../domain/analytics';
import { stableHash } from '../../domain/referral';

import type {
  AnalyticsClient,
  PlatformName,
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
  reason?: string;
  shareChannel?: string;
  isFirstSession?: boolean;
}

export class AnalyticsTracker {
  private readonly listeners = new Set<AnalyticsListener>();

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
    const occurredAt = this.now().toISOString();
    const properties: ReferralEventProperties = {
      referral_code: referralCode,
      platform: this.platform,
      event_id: `evt_${stableHash(milestoneKey)}`,
      flow_id: flowId,
      occurred_at_utc: occurredAt,
      schema_version: ANALYTICS_SCHEMA_VERSION,
      app_version: APP_VERSION,
      ...(options.attributionKind ? { attribution_kind: options.attributionKind } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.shareChannel ? { share_channel: options.shareChannel } : {}),
      ...(options.isFirstSession !== undefined
        ? { is_first_session: options.isFirstSession }
        : {}),
    };
    const event: ReferralEventRecord = { name, properties };

    if (once && (await this.storage.hasMilestone(milestoneKey))) {
      this.emit(event, 'duplicate');
      return 'duplicate';
    }

    try {
      await this.client.logEvent(event);
      if (once) await this.storage.markMilestone(milestoneKey);
      this.emit(event, 'accepted');
      return 'accepted';
    } catch {
      this.emit(event, 'failed');
      return 'failed';
    }
  }

  private emit(event: ReferralEventRecord, delivery: AnalyticsDelivery): void {
    this.listeners.forEach((listener) => listener(event, delivery));
  }
}
