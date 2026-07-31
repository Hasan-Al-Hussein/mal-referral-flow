import {
  parseReferralAttribution,
  stableHash,
  type RawDeepLinkEvent,
  type ReferralAttribution,
} from '../domain/referral';

import type { PlatformName } from '../domain/analytics';
import type { AnalyticsTracker } from '../services/analytics/AnalyticsTracker';
import type { DeepLinkService } from '../services/deepLinks/deepLinkService';
import type { MockReferralApi } from '../services/referrals/mockReferralApi';
import type { ShareResult, ShareService } from '../services/share/shareService';
import type { ReferralStorage } from '../services/storage/referralStorage';

export interface GeneratedReferral {
  referralCode: string;
  url: string;
}

export interface SignupResult {
  accountId: string;
  referralCode: string;
}

export type ReferralNavigator = (attribution: ReferralAttribution) => void;

export class ReferralCoordinator {
  private unsubscribeFromLinks: (() => void) | undefined;
  private navigator: ReferralNavigator | undefined;
  private bufferedRoute: ReferralAttribution | undefined;

  constructor(
    private readonly deepLinks: DeepLinkService,
    private readonly analytics: AnalyticsTracker,
    private readonly storage: ReferralStorage,
    private readonly referralApi: MockReferralApi,
    private readonly shareService: ShareService,
    private readonly platform: PlatformName,
  ) {}

  start(): void {
    if (this.unsubscribeFromLinks) return;
    this.unsubscribeFromLinks = this.deepLinks.subscribe((event) => {
      void this.handleDeepLink(event);
    });
    void this.restorePendingRoute();
  }

  stop(): void {
    this.unsubscribeFromLinks?.();
    this.unsubscribeFromLinks = undefined;
  }

  setNavigator(navigator: ReferralNavigator): void {
    this.navigator = navigator;
    if (this.bufferedRoute) {
      const route = this.bufferedRoute;
      this.bufferedRoute = undefined;
      navigator(route);
    }
  }

  async generateReferral(userId: string): Promise<GeneratedReferral> {
    let referralCode = 'UNAVAILABLE';
    try {
      referralCode = await this.referralApi.getOrCreateCode(userId);
      const url = await this.deepLinks.createReferralLink(referralCode);
      await this.analytics.track(
        'referral_link_generated',
        referralCode,
        `referrer:${referralCode}`,
      );
      return { referralCode, url };
    } catch (error) {
      await this.analytics.track(
        'referral_link_generation_failed',
        referralCode,
        `generation-failure:${referralCode}`,
        { reason: error instanceof Error ? error.message : 'unknown_error', once: false },
      );
      throw error;
    }
  }

  async shareReferral(referral: GeneratedReferral): Promise<ShareResult> {
    const result = await this.shareService.shareReferral(referral.url, referral.referralCode);
    const flowId = `referrer:${referral.referralCode}`;

    if (result.status === 'shared') {
      await this.analytics.track('referral_link_shared', referral.referralCode, flowId, {
        shareChannel: result.channel,
      });
    } else if (result.status === 'cancelled') {
      await this.analytics.track(
        'referral_link_share_cancelled',
        referral.referralCode,
        flowId,
        { reason: 'user_dismissed', once: false },
      );
    } else {
      await this.analytics.track(
        'referral_link_share_failed',
        referral.referralCode,
        flowId,
        { reason: result.reason, once: false },
      );
    }

    return result;
  }

  async handleDeepLink(event: RawDeepLinkEvent): Promise<void> {
    const parsed = parseReferralAttribution(event);
    if (parsed.status === 'ignored') return;

    if (parsed.status === 'rejected') {
      const flowId = `rejected:${stableHash(`${parsed.referralCode}:${parsed.reason}`)}`;
      await this.analytics.track(
        'referral_deeplink_resolution_failed',
        parsed.referralCode,
        flowId,
        { reason: parsed.reason, once: false },
      );
      if (parsed.reason === 'invalid_code' || parsed.reason === 'missing_code') {
        await this.analytics.track('referral_code_rejected', parsed.referralCode, flowId, {
          reason: parsed.reason,
          once: false,
        });
      }
      return;
    }

    const { attribution } = parsed;
    const flowId = `invitee:${attribution.fingerprint}`;
    const frozenCode = await this.storage.getFrozenReferralCode();
    if (frozenCode && frozenCode !== attribution.referralCode) {
      await this.analytics.track(
        'referral_code_rejected',
        attribution.referralCode,
        flowId,
        {
          attributionKind: attribution.kind,
          reason: 'signup_referral_already_frozen',
          once: false,
        },
      );
      return;
    }

    if (await this.storage.hasProcessedAttribution(attribution.fingerprint)) {
      await this.analytics.track(
        'referral_duplicate_suppressed',
        attribution.referralCode,
        flowId,
        { attributionKind: attribution.kind, reason: 'callback_replayed', once: false },
      );
      this.route(attribution);
      return;
    }

    // Persistence deliberately precedes analytics and routing. A process death at
    // either later step can recover the accepted referral on the next launch.
    await this.storage.savePendingAttribution(attribution);
    const delivery = await this.analytics.track(
      'referral_link_clicked',
      attribution.referralCode,
      flowId,
      {
        attributionKind: attribution.kind,
        isFirstSession: attribution.kind === 'deferred' || attribution.kind === 'demo-deferred',
      },
    );
    if (delivery !== 'failed') {
      await this.storage.markAttributionProcessed(attribution.fingerprint);
    }
    this.route(attribution);
  }

  async beginSignup(referralCode: string, attribution: ReferralAttribution): Promise<string> {
    const alreadyFrozen = await this.storage.getFrozenReferralCode();
    const code = alreadyFrozen ?? referralCode;
    if (!alreadyFrozen) await this.storage.freezeReferralCode(code);
    await this.analytics.track(
      'referral_signup_started',
      code,
      `invitee:${attribution.fingerprint}`,
      {
        attributionKind: attribution.kind,
        isFirstSession: attribution.kind === 'deferred' || attribution.kind === 'demo-deferred',
      },
    );
    return code;
  }

  async completeSignup(
    referralCode: string,
    email: string,
    attribution: ReferralAttribution,
  ): Promise<SignupResult> {
    const frozenCode = (await this.storage.getFrozenReferralCode()) ?? referralCode;
    const flowId = `invitee:${attribution.fingerprint}`;
    try {
      const result = await this.referralApi.acceptReferral(frozenCode, email);
      await this.analytics.track('referral_signup_completed', frozenCode, flowId, {
        attributionKind: attribution.kind,
        isFirstSession: attribution.kind === 'deferred' || attribution.kind === 'demo-deferred',
      });
      await Promise.all([
        this.storage.clearPendingAttribution(),
        this.storage.clearFrozenReferralCode(),
      ]);
      return { ...result, referralCode: frozenCode };
    } catch (error) {
      await this.analytics.track('referral_signup_failed', frozenCode, flowId, {
        attributionKind: attribution.kind,
        reason: error instanceof Error ? error.message : 'unknown_error',
        once: false,
      });
      throw error;
    }
  }

  simulateLink(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void {
    this.deepLinks.simulate(kind, referralCode);
  }

  async resetDemoState(): Promise<void> {
    await this.storage.resetDemoState();
  }

  get integrationMode(): DeepLinkService['mode'] {
    return this.deepLinks.mode;
  }

  get platformName(): PlatformName {
    return this.platform;
  }

  private async restorePendingRoute(): Promise<void> {
    const pending = await this.storage.getPendingAttribution();
    if (pending) this.route(pending);
  }

  private route(attribution: ReferralAttribution): void {
    if (this.navigator) {
      this.navigator(attribution);
    } else {
      this.bufferedRoute = attribution;
    }
  }
}
