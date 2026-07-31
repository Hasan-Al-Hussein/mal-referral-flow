import {
  isShareableReferralUrl,
  isValidReferralCode,
  normalizeReferralCode,
  parseReferralAttribution,
  parseStoredReferralAttribution,
  REFERRAL_CODE_UNAVAILABLE,
  referralCodeForTelemetry,
  stableHash,
  type RawDeepLinkEvent,
  type ReferralAttribution,
} from '../domain/referral';

import type { PlatformName, ReferralDiagnosticReason } from '../domain/analytics';
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
  private lastRoutedFingerprint: string | undefined;
  private shareAttemptSequence = 0;
  private deepLinkQueue: Promise<void> = Promise.resolve();
  private signupQueue: Promise<void> = Promise.resolve();
  private readonly generationRequests = new Map<string, Promise<GeneratedReferral>>();
  private readonly completionRequests = new Map<string, Promise<SignupResult>>();

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
    try {
      this.unsubscribeFromLinks = this.deepLinks.subscribe((event) => {
        void this.handleDeepLink(event).catch(() =>
          this.reportLinkProcessingFailure('callback_processing_failed'),
        );
      });
    } catch {
      void this.reportLinkProcessingFailure('subscription_failed');
      return;
    }

    void this.analytics.flushPending();
    void this.enqueueDeepLink(() => this.restorePendingRoute()).catch(() =>
      this.reportLinkProcessingFailure('pending_restore_failed'),
    );
  }

  stop(): void {
    try {
      this.unsubscribeFromLinks?.();
    } finally {
      this.unsubscribeFromLinks = undefined;
    }
  }

  setNavigator(navigator: ReferralNavigator): void {
    this.navigator = navigator;
    if (this.bufferedRoute) {
      const route = this.bufferedRoute;
      this.bufferedRoute = undefined;
      navigator(route);
    }
  }

  generateReferral(userId: string): Promise<GeneratedReferral> {
    const requestKey = userId.trim();
    const existing = requestKey ? this.generationRequests.get(requestKey) : undefined;
    if (existing) return existing;

    const request = this.generateReferralUnlocked(requestKey);
    if (requestKey) {
      this.generationRequests.set(requestKey, request);
      void request.then(
        () => this.clearGenerationRequest(requestKey, request),
        () => this.clearGenerationRequest(requestKey, request),
      );
    }
    return request;
  }

  async shareReferral(referral: GeneratedReferral): Promise<ShareResult> {
    this.shareAttemptSequence += 1;
    const flowId = `referrer:${referral.referralCode}:share:${Date.now().toString(36)}:${this.shareAttemptSequence}`;
    let result: ShareResult;
    try {
      result = await this.shareService.shareReferral(referral.url, referral.referralCode);
    } catch (error) {
      result = {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Share failed',
      };
    }

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
        { reason: 'share_provider_failed', once: false },
      );
    }

    return result;
  }

  handleDeepLink(event: RawDeepLinkEvent): Promise<void> {
    return this.enqueueDeepLink(() => this.processDeepLink(event));
  }

  beginSignup(referralCode: string, attribution: ReferralAttribution): Promise<string> {
    return this.enqueueSignup(() => this.beginSignupUnlocked(referralCode, attribution));
  }

  completeSignup(
    referralCode: string,
    email: string,
    attribution: ReferralAttribution,
  ): Promise<SignupResult> {
    const requestKey = attribution.fingerprint;
    const existing = this.completionRequests.get(requestKey);
    if (existing) return existing;

    const request = this.enqueueSignup(() =>
      this.completeSignupUnlocked(referralCode, email, attribution),
    );
    this.completionRequests.set(requestKey, request);
    void request.then(
      () => this.clearCompletionRequest(requestKey, request),
      () => this.clearCompletionRequest(requestKey, request),
    );
    return request;
  }

  simulateLink(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void {
    this.deepLinks.simulate(kind, referralCode);
  }

  resetDemoState(): Promise<void> {
    return this.enqueueDeepLink(() =>
      this.enqueueSignup(async () => {
        await this.storage.resetDemoState();
        this.bufferedRoute = undefined;
        this.lastRoutedFingerprint = undefined;
        this.shareAttemptSequence = 0;
      }),
    );
  }

  get integrationMode(): DeepLinkService['mode'] {
    return this.deepLinks.mode;
  }

  get platformName(): PlatformName {
    return this.platform;
  }

  private async generateReferralUnlocked(userId: string): Promise<GeneratedReferral> {
    let referralCode = REFERRAL_CODE_UNAVAILABLE;
    let failureReason: ReferralDiagnosticReason = 'code_generation_failed';
    try {
      if (!userId) {
        failureReason = 'authentication_required';
        throw new Error('Authenticated member identity is required.');
      }
      const generatedCode = await this.referralApi.getOrCreateCode(userId);
      if (!isValidReferralCode(generatedCode)) {
        failureReason = 'invalid_generated_code';
        throw new Error('Referral service returned an invalid code.');
      }
      referralCode = normalizeReferralCode(generatedCode);
      failureReason = 'link_generation_failed';
      const url = await this.deepLinks.createReferralLink(referralCode);
      if (!isShareableReferralUrl(url)) {
        failureReason = 'invalid_generated_url';
        throw new Error('Link provider returned an unusable URL.');
      }
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
        { reason: failureReason, once: false },
      );
      throw error;
    }
  }

  private async processDeepLink(event: RawDeepLinkEvent): Promise<void> {
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
    if (frozenCode) {
      if (frozenCode !== attribution.referralCode) {
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
      } else {
        await this.analytics.track(
          'referral_duplicate_suppressed',
          attribution.referralCode,
          flowId,
          {
            attributionKind: attribution.kind,
            reason: 'signup_already_started',
            once: false,
          },
        );
      }
      return;
    }

    if (await this.storage.hasProcessedAttribution(attribution.fingerprint)) {
      await this.analytics.track(
        'referral_duplicate_suppressed',
        attribution.referralCode,
        flowId,
        { attributionKind: attribution.kind, reason: 'callback_replayed', once: false },
      );
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
        ...(attribution.matchGuaranteed !== undefined
          ? { matchGuaranteed: attribution.matchGuaranteed }
          : {}),
      },
    );
    if (delivery !== 'failed') {
      await this.storage.markAttributionProcessed(attribution.fingerprint);
    }
    this.route(attribution);
  }

  private async beginSignupUnlocked(
    referralCode: string,
    attribution: ReferralAttribution,
  ): Promise<string> {
    const safeAttribution = parseStoredReferralAttribution(attribution);
    const submittedCode = normalizeReferralCode(referralCode);
    if (!safeAttribution || submittedCode !== safeAttribution.referralCode) {
      const telemetryCode = referralCodeForTelemetry(referralCode);
      await this.analytics.track(
        'referral_code_rejected',
        telemetryCode,
        `signup-start-rejected:${stableHash(telemetryCode)}`,
        { reason: 'signup_code_mismatch', once: false },
      );
      throw new Error('Referral attribution does not match this signup.');
    }

    const alreadyFrozen = await this.storage.getFrozenReferralCode();
    if (alreadyFrozen && alreadyFrozen !== safeAttribution.referralCode) {
      await this.analytics.track(
        'referral_code_rejected',
        safeAttribution.referralCode,
        `invitee:${safeAttribution.fingerprint}`,
        { reason: 'signup_referral_already_frozen', once: false },
      );
      throw new Error('Another referral is already attached to this signup.');
    }

    if (!alreadyFrozen) await this.storage.freezeReferralCode(safeAttribution.referralCode);
    await this.analytics.track(
      'referral_signup_started',
      safeAttribution.referralCode,
      `invitee:${safeAttribution.fingerprint}`,
      {
        attributionKind: safeAttribution.kind,
        isFirstSession:
          safeAttribution.kind === 'deferred' || safeAttribution.kind === 'demo-deferred',
        ...(safeAttribution.matchGuaranteed !== undefined
          ? { matchGuaranteed: safeAttribution.matchGuaranteed }
          : {}),
      },
    );
    return safeAttribution.referralCode;
  }

  private async completeSignupUnlocked(
    _referralCode: string,
    email: string,
    attribution: ReferralAttribution,
  ): Promise<SignupResult> {
    const safeAttribution = parseStoredReferralAttribution(attribution);
    const flowId = safeAttribution
      ? `invitee:${safeAttribution.fingerprint}`
      : 'invitee:invalid-attribution';
    const frozenCode = await this.storage.getFrozenReferralCode();
    if (!safeAttribution || !frozenCode || frozenCode !== safeAttribution.referralCode) {
      const telemetryCode = referralCodeForTelemetry(frozenCode ?? attribution.referralCode);
      await this.analytics.track('referral_signup_failed', telemetryCode, flowId, {
        reason: frozenCode ? 'frozen_code_mismatch' : 'signup_not_started',
        once: false,
      });
      throw new Error('Signup must start with the persisted referral before completion.');
    }

    try {
      const idempotencyKey = `signup:${safeAttribution.fingerprint}`;
      const result = await this.referralApi.acceptReferral(
        frozenCode,
        email,
        idempotencyKey,
      );
      await this.analytics.track('referral_signup_completed', frozenCode, flowId, {
        attributionKind: safeAttribution.kind,
        isFirstSession:
          safeAttribution.kind === 'deferred' || safeAttribution.kind === 'demo-deferred',
        ...(safeAttribution.matchGuaranteed !== undefined
          ? { matchGuaranteed: safeAttribution.matchGuaranteed }
          : {}),
      });
      await Promise.all([
        this.storage.clearPendingAttribution(),
        this.storage.clearFrozenReferralCode(),
      ]);
      return { ...result, referralCode: frozenCode };
    } catch (error) {
      await this.analytics.track('referral_signup_failed', frozenCode, flowId, {
        attributionKind: safeAttribution.kind,
        reason: 'referral_acceptance_failed',
        once: false,
      });
      throw error;
    }
  }

  private async restorePendingRoute(): Promise<void> {
    const pending = await this.storage.getPendingAttribution();
    if (pending) this.route(pending);
  }

  private route(attribution: ReferralAttribution): void {
    if (this.lastRoutedFingerprint === attribution.fingerprint) return;
    this.lastRoutedFingerprint = attribution.fingerprint;
    if (this.navigator) {
      this.navigator(attribution);
    } else {
      this.bufferedRoute = attribution;
    }
  }

  private enqueueDeepLink<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.deepLinkQueue.then(operation);
    this.deepLinkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private enqueueSignup<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.signupQueue.then(operation);
    this.signupQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async reportLinkProcessingFailure(reason: ReferralDiagnosticReason): Promise<void> {
    await this.analytics.track(
      'referral_deeplink_resolution_failed',
      REFERRAL_CODE_UNAVAILABLE,
      `runtime-link-failure:${reason}`,
      { reason, once: false },
    );
  }

  private clearGenerationRequest(
    key: string,
    request: Promise<GeneratedReferral>,
  ): void {
    if (this.generationRequests.get(key) === request) this.generationRequests.delete(key);
  }

  private clearCompletionRequest(key: string, request: Promise<SignupResult>): void {
    if (this.completionRequests.get(key) === request) this.completionRequests.delete(key);
  }
}
