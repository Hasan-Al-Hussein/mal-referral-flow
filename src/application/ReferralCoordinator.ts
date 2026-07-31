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
import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  withTimeout,
} from '../services/operationTimeout';

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
export type ReferralJourneyListener = (attribution: ReferralAttribution) => void;

class ReferralLifecycleCancelledError extends Error {
  constructor() {
    super('Referral operation was cancelled by a state reset.');
  }
}

function sameJourneyIdentity(
  first: ReferralAttribution,
  second: ReferralAttribution,
): boolean {
  return (
    first.referralCode === second.referralCode &&
    first.fingerprint === second.fingerprint
  );
}

export class ReferralCoordinator {
  private unsubscribeFromLinks: (() => void) | undefined;
  private navigator: ReferralNavigator | undefined;
  private bufferedRoute: ReferralAttribution | undefined;
  private lastRoutedFingerprint: string | undefined;
  private shareAttemptSequence = 0;
  private lifecycle = 0;
  private resetBarrier: Promise<void> = Promise.resolve();
  private deepLinkQueue: Promise<void> = Promise.resolve();
  private signupQueue: Promise<void> = Promise.resolve();
  private readonly generationRequests = new Map<string, Promise<GeneratedReferral>>();
  private readonly completionRequests = new Map<string, Promise<SignupResult>>();
  private readonly journeyListeners = new Set<ReferralJourneyListener>();

  constructor(
    private readonly deepLinks: DeepLinkService,
    private readonly analytics: AnalyticsTracker,
    private readonly storage: ReferralStorage,
    private readonly referralApi: MockReferralApi,
    private readonly shareService: ShareService,
    private readonly platform: PlatformName,
    private readonly timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  ) {}

  start(): void {
    if (this.unsubscribeFromLinks) return;
    try {
      this.unsubscribeFromLinks = this.deepLinks.subscribe((event) => {
        const lifecycle = this.lifecycle;
        void this.handleDeepLink(event).catch((error: unknown) => {
          if (!this.isCancellation(error) && this.isCurrent(lifecycle)) {
            void this.reportLinkProcessingFailure('callback_processing_failed', lifecycle);
          }
        });
      });
    } catch {
      const lifecycle = this.lifecycle;
      void this.reportLinkProcessingFailure('subscription_failed', lifecycle);
      return;
    }

    const lifecycle = this.lifecycle;
    void this.afterReset(lifecycle)
      .then(() => this.analytics.flushPending())
      .catch(() => undefined);
    void this.enqueueDeepLink(lifecycle, () => this.restorePendingRoute(lifecycle)).catch(
      (error: unknown) => {
        if (!this.isCancellation(error) && this.isCurrent(lifecycle)) {
          void this.reportLinkProcessingFailure('pending_restore_failed', lifecycle);
        }
      },
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

  subscribeToJourney(listener: ReferralJourneyListener): () => void {
    this.journeyListeners.add(listener);
    return () => this.journeyListeners.delete(listener);
  }

  generateReferral(userId: string): Promise<GeneratedReferral> {
    const lifecycle = this.lifecycle;
    const requestKey = userId.trim();
    const mapKey = `${lifecycle}:${requestKey}`;
    const existing = requestKey ? this.generationRequests.get(mapKey) : undefined;
    if (existing) return existing;

    const request = this.afterReset(lifecycle).then(() =>
      this.generateReferralUnlocked(requestKey, lifecycle),
    );
    if (requestKey) {
      this.generationRequests.set(mapKey, request);
      void request.then(
        () => this.clearGenerationRequest(mapKey, request),
        () => this.clearGenerationRequest(mapKey, request),
      );
    }
    return request;
  }

  async shareReferral(referral: GeneratedReferral): Promise<ShareResult> {
    const lifecycle = this.lifecycle;
    await this.afterReset(lifecycle);
    this.shareAttemptSequence += 1;
    const flowId = `referrer:${referral.referralCode}:share:${Date.now().toString(36)}:${this.shareAttemptSequence}`;
    let result: ShareResult;
    try {
      result = await this.boundary(
        this.shareService.shareReferral(referral.url, referral.referralCode),
        lifecycle,
        'native share request',
      );
    } catch (error) {
      if (this.isCancellation(error)) throw error;
      result = {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Share failed',
      };
    }

    if (result.status === 'shared') {
      await this.track(lifecycle, 'referral_link_shared', referral.referralCode, flowId, {
        shareChannel: result.channel,
      });
    } else if (result.status === 'cancelled') {
      await this.track(
        lifecycle,
        'referral_link_share_cancelled',
        referral.referralCode,
        flowId,
        { reason: 'user_dismissed', once: false },
      );
    } else {
      await this.track(
        lifecycle,
        'referral_link_share_failed',
        referral.referralCode,
        flowId,
        { reason: 'share_provider_failed', once: false },
      );
    }

    return result;
  }

  handleDeepLink(event: RawDeepLinkEvent): Promise<void> {
    const lifecycle = this.lifecycle;
    return this.enqueueDeepLink(lifecycle, () => this.processDeepLink(event, lifecycle));
  }

  beginSignup(referralCode: string, attribution: ReferralAttribution): Promise<string> {
    const lifecycle = this.lifecycle;
    return this.enqueueSignup(lifecycle, () =>
      this.beginSignupUnlocked(referralCode, attribution, lifecycle),
    );
  }

  completeSignup(
    referralCode: string,
    email: string,
    attribution: ReferralAttribution,
  ): Promise<SignupResult> {
    const lifecycle = this.lifecycle;
    const requestKey = `${lifecycle}:${attribution.fingerprint}`;
    const existing = this.completionRequests.get(requestKey);
    if (existing) return existing;

    const request = this.enqueueSignup(lifecycle, () =>
      this.completeSignupUnlocked(referralCode, email, attribution, lifecycle),
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
    this.lifecycle += 1;
    this.analytics.resetLifecycle();
    this.referralApi.resetLifecycle?.();
    this.deepLinkQueue = Promise.resolve();
    this.signupQueue = Promise.resolve();
    this.generationRequests.clear();
    this.completionRequests.clear();
    this.bufferedRoute = undefined;
    this.lastRoutedFingerprint = undefined;
    this.shareAttemptSequence = 0;

    const reset = withTimeout(
      this.storage.resetDemoState(),
      'referral state reset',
      this.timeoutMs,
    ).then(
      () => undefined,
      () => undefined,
    );
    this.resetBarrier = reset;
    return reset;
  }

  get integrationMode(): DeepLinkService['mode'] {
    return this.deepLinks.mode;
  }

  get platformName(): PlatformName {
    return this.platform;
  }

  private async generateReferralUnlocked(
    userId: string,
    lifecycle: number,
  ): Promise<GeneratedReferral> {
    let referralCode = REFERRAL_CODE_UNAVAILABLE;
    let failureReason: ReferralDiagnosticReason = 'code_generation_failed';
    try {
      if (!userId) {
        failureReason = 'authentication_required';
        throw new Error('Authenticated member identity is required.');
      }
      const generatedCode = await this.boundary(
        this.referralApi.getOrCreateCode(userId),
        lifecycle,
        'referral code generation',
      );
      if (!isValidReferralCode(generatedCode)) {
        failureReason = 'invalid_generated_code';
        throw new Error('Referral service returned an invalid code.');
      }
      referralCode = normalizeReferralCode(generatedCode);
      failureReason = 'link_generation_failed';
      const url = await this.boundary(
        this.deepLinks.createReferralLink(referralCode),
        lifecycle,
        'Branch link generation',
      );
      if (!isShareableReferralUrl(url)) {
        failureReason = 'invalid_generated_url';
        throw new Error('Link provider returned an unusable URL.');
      }
      await this.track(
        lifecycle,
        'referral_link_generated',
        referralCode,
        `referrer:${referralCode}`,
      );
      return { referralCode, url };
    } catch (error) {
      if (this.isCancellation(error)) throw error;
      await this.track(
        lifecycle,
        'referral_link_generation_failed',
        referralCode,
        `generation-failure:${referralCode}`,
        { reason: failureReason, once: false },
      );
      throw error;
    }
  }

  private async processDeepLink(event: RawDeepLinkEvent, lifecycle: number): Promise<void> {
    const parsed = parseReferralAttribution(event);
    if (parsed.status === 'ignored') return;

    if (parsed.status === 'rejected') {
      const flowId = `rejected:${stableHash(`${parsed.referralCode}:${parsed.reason}`)}`;
      await this.track(
        lifecycle,
        'referral_deeplink_resolution_failed',
        parsed.referralCode,
        flowId,
        { reason: parsed.reason, once: false },
      );
      if (parsed.reason === 'invalid_code' || parsed.reason === 'missing_code') {
        await this.track(
          lifecycle,
          'referral_code_rejected',
          parsed.referralCode,
          flowId,
          { reason: parsed.reason, once: false },
        );
      }
      return;
    }

    const { attribution } = parsed;
    const flowId = `invitee:${attribution.fingerprint}`;
    const frozen = await this.getFrozenAfterAcceptedCleanup(lifecycle);
    if (frozen) {
      if (!sameJourneyIdentity(frozen, attribution)) {
        await this.track(
          lifecycle,
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
        await this.track(
          lifecycle,
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

    if (
      await this.boundary(
        this.storage.hasProcessedAttribution(attribution.fingerprint),
        lifecycle,
        'processed attribution read',
      )
    ) {
      await this.track(
        lifecycle,
        'referral_duplicate_suppressed',
        attribution.referralCode,
        flowId,
        { attributionKind: attribution.kind, reason: 'callback_replayed', once: false },
      );
      return;
    }

    // Persistence deliberately precedes analytics and routing. A process death at
    // either later step can recover the accepted referral on the next launch.
    await this.boundary(
      this.storage.savePendingAttribution(attribution),
      lifecycle,
      'pending attribution write',
    );
    const delivery = await this.track(
      lifecycle,
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
      await this.boundary(
        this.storage.markAttributionProcessed(attribution.fingerprint),
        lifecycle,
        'processed attribution write',
      );
    }
    this.route(attribution, lifecycle);
  }

  private async beginSignupUnlocked(
    referralCode: string,
    attribution: ReferralAttribution,
    lifecycle: number,
  ): Promise<string> {
    const suppliedAttribution = parseStoredReferralAttribution(attribution);
    const submittedCode = normalizeReferralCode(referralCode);
    const pending = await this.boundary(
      this.storage.getPendingAttribution(),
      lifecycle,
      'pending signup attribution read',
    );
    if (
      !suppliedAttribution ||
      !pending ||
      submittedCode !== pending.referralCode ||
      !sameJourneyIdentity(suppliedAttribution, pending)
    ) {
      const telemetryCode = referralCodeForTelemetry(referralCode);
      await this.track(
        lifecycle,
        'referral_code_rejected',
        telemetryCode,
        `signup-start-rejected:${stableHash(telemetryCode)}`,
        { reason: 'signup_code_mismatch', once: false },
      );
      throw new Error('Referral attribution does not match the persisted signup journey.');
    }

    const alreadyFrozen = await this.getFrozenAfterAcceptedCleanup(lifecycle);
    if (alreadyFrozen && !sameJourneyIdentity(alreadyFrozen, pending)) {
      await this.track(
        lifecycle,
        'referral_code_rejected',
        pending.referralCode,
        `invitee:${pending.fingerprint}`,
        { reason: 'signup_referral_already_frozen', once: false },
      );
      throw new Error('Another referral is already attached to this signup.');
    }

    if (!alreadyFrozen) {
      await this.boundary(
        this.storage.freezeAttribution(pending),
        lifecycle,
        'signup attribution freeze',
      );
    }
    await this.track(
      lifecycle,
      'referral_signup_started',
      pending.referralCode,
      `invitee:${pending.fingerprint}`,
      {
        attributionKind: pending.kind,
        isFirstSession: pending.kind === 'deferred' || pending.kind === 'demo-deferred',
        ...(pending.matchGuaranteed !== undefined
          ? { matchGuaranteed: pending.matchGuaranteed }
          : {}),
      },
    );
    return pending.referralCode;
  }

  private async completeSignupUnlocked(
    _referralCode: string,
    email: string,
    attribution: ReferralAttribution,
    lifecycle: number,
  ): Promise<SignupResult> {
    const suppliedAttribution = parseStoredReferralAttribution(attribution);
    const frozen = await this.boundary(
      this.storage.getFrozenAttribution(),
      lifecycle,
      'frozen signup attribution read',
    );
    const flowId = frozen
      ? `invitee:${frozen.fingerprint}`
      : suppliedAttribution
        ? `invitee:${suppliedAttribution.fingerprint}`
        : 'invitee:invalid-attribution';
    if (!suppliedAttribution || !frozen || !sameJourneyIdentity(frozen, suppliedAttribution)) {
      const telemetryCode = referralCodeForTelemetry(
        frozen?.referralCode ?? attribution.referralCode,
      );
      await this.track(lifecycle, 'referral_signup_failed', telemetryCode, flowId, {
        reason: frozen ? 'frozen_code_mismatch' : 'signup_not_started',
        once: false,
      });
      throw new Error(
        'Signup must start with and complete from its persisted referral attribution.',
      );
    }

    const idempotencyKey = `signup:${frozen.fingerprint}`;
    let accepted: { accountId: string };
    try {
      accepted = await this.boundary(
        this.referralApi.acceptReferral(frozen.referralCode, email, idempotencyKey),
        lifecycle,
        'referral acceptance',
      );
    } catch (error) {
      if (this.isCancellation(error)) throw error;
      await this.track(lifecycle, 'referral_signup_failed', frozen.referralCode, flowId, {
        attributionKind: frozen.kind,
        reason: 'referral_acceptance_failed',
        once: false,
      });
      throw error;
    }

    // Backend acceptance is the commit point. Analytics and local cleanup are
    // retryable follow-up work and must never relabel an accepted signup as failed.
    await this.track(lifecycle, 'referral_signup_completed', frozen.referralCode, flowId, {
      attributionKind: frozen.kind,
      isFirstSession: frozen.kind === 'deferred' || frozen.kind === 'demo-deferred',
      ...(frozen.matchGuaranteed !== undefined
        ? { matchGuaranteed: frozen.matchGuaranteed }
        : {}),
    });
    try {
      await this.boundary(
        this.storage.completeReferralJourney(frozen),
        lifecycle,
        'accepted referral cleanup',
      );
    } catch (error) {
      if (this.isCancellation(error)) throw error;
      // The frozen identity and idempotent backend receipt deliberately remain.
      // Startup and the next referral operation retry this one-record cleanup.
      await this.reportAcceptedCleanupFailure(frozen, lifecycle);
    }
    return { ...accepted, referralCode: frozen.referralCode };
  }

  private async restorePendingRoute(lifecycle: number): Promise<void> {
    await this.getFrozenAfterAcceptedCleanup(lifecycle);
    const pending = await this.boundary(
      this.storage.getPendingAttribution(),
      lifecycle,
      'pending attribution restore',
    );
    if (pending) this.route(pending, lifecycle);
  }

  private async getFrozenAfterAcceptedCleanup(
    lifecycle: number,
  ): Promise<ReferralAttribution | null> {
    const frozen = await this.boundary(
      this.storage.getFrozenAttribution(),
      lifecycle,
      'frozen attribution read',
    );
    if (!frozen) return null;
    const receipt = await this.boundary(
      this.storage.getSignupReceipt(`signup:${frozen.fingerprint}`),
      lifecycle,
      'accepted referral receipt read',
    );
    if (!receipt || receipt.referralCode !== frozen.referralCode) return frozen;

    try {
      await this.boundary(
        this.storage.completeReferralJourney(frozen),
        lifecycle,
        'accepted referral cleanup retry',
      );
      return null;
    } catch (error) {
      if (this.isCancellation(error)) throw error;
      await this.reportAcceptedCleanupFailure(frozen, lifecycle);
      return frozen;
    }
  }

  private route(attribution: ReferralAttribution, lifecycle: number): void {
    if (!this.isCurrent(lifecycle)) throw new ReferralLifecycleCancelledError();
    if (this.lastRoutedFingerprint === attribution.fingerprint) return;
    this.lastRoutedFingerprint = attribution.fingerprint;
    this.journeyListeners.forEach((listener) => {
      try {
        listener(attribution);
      } catch {
        // Presentation observers cannot change routing or referral state.
      }
    });
    if (this.navigator) {
      this.navigator(attribution);
    } else {
      this.bufferedRoute = attribution;
    }
  }

  private enqueueDeepLink<T>(
    lifecycle: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.deepLinkQueue
      .then(() => this.afterReset(lifecycle))
      .then(operation);
    this.deepLinkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private enqueueSignup<T>(
    lifecycle: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.signupQueue
      .then(() => this.afterReset(lifecycle))
      .then(operation);
    this.signupQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async afterReset(lifecycle: number): Promise<void> {
    await this.resetBarrier;
    if (!this.isCurrent(lifecycle)) throw new ReferralLifecycleCancelledError();
  }

  private async boundary<T>(
    operation: Promise<T>,
    lifecycle: number,
    operationName: string,
  ): Promise<T> {
    const result = await withTimeout(operation, operationName, this.timeoutMs);
    if (!this.isCurrent(lifecycle)) throw new ReferralLifecycleCancelledError();
    return result;
  }

  private track(
    lifecycle: number,
    ...parameters: Parameters<AnalyticsTracker['track']>
  ): Promise<Awaited<ReturnType<AnalyticsTracker['track']>>> {
    if (!this.isCurrent(lifecycle)) {
      return Promise.reject(new ReferralLifecycleCancelledError());
    }
    return this.boundary(
      this.analytics.track(...parameters),
      lifecycle,
      `analytics ${parameters[0]}`,
    );
  }

  private async reportLinkProcessingFailure(
    reason: ReferralDiagnosticReason,
    lifecycle: number,
  ): Promise<void> {
    if (!this.isCurrent(lifecycle)) return;
    try {
      await this.track(
        lifecycle,
        'referral_deeplink_resolution_failed',
        REFERRAL_CODE_UNAVAILABLE,
        `runtime-link-failure:${reason}`,
        { reason, once: false },
      );
    } catch {
      // Diagnostics cannot be allowed to wedge subscription or reset lifecycles.
    }
  }

  private async reportAcceptedCleanupFailure(
    attribution: ReferralAttribution,
    lifecycle: number,
  ): Promise<void> {
    if (!this.isCurrent(lifecycle)) return;
    try {
      await this.track(
        lifecycle,
        'referral_state_cleanup_failed',
        attribution.referralCode,
        `invitee:${attribution.fingerprint}`,
        {
          attributionKind: attribution.kind,
          reason: 'accepted_cleanup_failed',
          once: false,
        },
      );
    } catch (error) {
      if (this.isCancellation(error)) throw error;
      // Cleanup remains recoverable through the persisted receipt even when its
      // diagnostic adapter is also unavailable.
    }
  }

  private isCurrent(lifecycle: number): boolean {
    return lifecycle === this.lifecycle;
  }

  private isCancellation(error: unknown): boolean {
    return error instanceof ReferralLifecycleCancelledError;
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
