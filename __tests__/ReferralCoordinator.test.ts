import { describe, expect, it } from '@jest/globals';

import { ReferralCoordinator } from '../src/application/ReferralCoordinator';
import {
  REFERRAL_DESTINATION,
  parseReferralAttribution,
  type RawDeepLinkEvent,
  type ReferralAttribution,
} from '../src/domain/referral';
import { AnalyticsTracker } from '../src/services/analytics/AnalyticsTracker';

import type {
  AnalyticsClient,
  ReferralEventName,
  ReferralEventRecord,
} from '../src/domain/analytics';
import type { DeepLinkService } from '../src/services/deepLinks/deepLinkService';
import type { MockReferralApi } from '../src/services/referrals/mockReferralApi';
import type { ShareResult, ShareService } from '../src/services/share/shareService';
import type {
  ReferralAcceptanceReceipt,
  ReferralStorage,
} from '../src/services/storage/referralStorage';

const CODE_A = 'MAL-ABCD2345';
const CODE_B = 'MAL-ZYXW9876';
const FIXED_NOW = new Date('2026-07-31T12:00:00.000Z');

class MemoryStorage implements ReferralStorage {
  readonly operations: string[];
  readonly processedAttributions = new Set<string>();
  readonly milestones = new Set<string>();
  readonly pendingAnalyticsEvents = new Map<string, ReferralEventRecord>();
  readonly signupReceipts = new Map<string, ReferralAcceptanceReceipt>();
  getPendingError: Error | undefined;
  savePendingError: Error | undefined;
  private readonly generatedCodes = new Map<string, string>();
  private pendingAttribution: ReferralAttribution | null = null;
  private frozenReferralCode: string | null = null;

  constructor(operations: string[] = []) {
    this.operations = operations;
  }

  async getGeneratedCode(userId: string): Promise<string | null> {
    return this.generatedCodes.get(userId) ?? null;
  }

  async setGeneratedCode(userId: string, code: string): Promise<void> {
    this.generatedCodes.set(userId, code);
  }

  async getPendingAttribution(): Promise<ReferralAttribution | null> {
    if (this.getPendingError) throw this.getPendingError;
    return this.pendingAttribution;
  }

  async savePendingAttribution(attribution: ReferralAttribution): Promise<void> {
    if (this.savePendingError) throw this.savePendingError;
    this.operations.push('storage:save-pending');
    this.pendingAttribution = attribution;
  }

  async clearPendingAttribution(): Promise<void> {
    this.operations.push('storage:clear-pending');
    this.pendingAttribution = null;
  }

  async getFrozenReferralCode(): Promise<string | null> {
    return this.frozenReferralCode;
  }

  async freezeReferralCode(code: string): Promise<void> {
    this.operations.push('storage:freeze-code');
    this.frozenReferralCode = code;
  }

  async clearFrozenReferralCode(): Promise<void> {
    this.operations.push('storage:clear-frozen-code');
    this.frozenReferralCode = null;
  }

  async hasProcessedAttribution(fingerprint: string): Promise<boolean> {
    return this.processedAttributions.has(fingerprint);
  }

  async markAttributionProcessed(fingerprint: string): Promise<void> {
    this.operations.push('storage:mark-processed');
    this.processedAttributions.add(fingerprint);
  }

  async hasMilestone(key: string): Promise<boolean> {
    return this.milestones.has(key);
  }

  async markMilestone(key: string): Promise<void> {
    this.operations.push('storage:mark-milestone');
    this.milestones.add(key);
  }

  async getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    return [...this.pendingAnalyticsEvents.values()];
  }

  async savePendingAnalyticsEvent(event: ReferralEventRecord): Promise<void> {
    this.operations.push('storage:save-analytics');
    this.pendingAnalyticsEvents.set(event.properties.event_id, event);
  }

  async removePendingAnalyticsEvent(eventId: string): Promise<void> {
    this.operations.push('storage:remove-analytics');
    this.pendingAnalyticsEvents.delete(eventId);
  }

  async getSignupReceipt(idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null> {
    return this.signupReceipts.get(idempotencyKey) ?? null;
  }

  async saveSignupReceipt(
    idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<void> {
    this.signupReceipts.set(idempotencyKey, receipt);
  }

  async resetDemoState(): Promise<void> {
    this.pendingAttribution = null;
    this.frozenReferralCode = null;
    this.processedAttributions.clear();
    this.milestones.clear();
    this.pendingAnalyticsEvents.clear();
    this.signupReceipts.clear();
  }
}

class MemoryAnalyticsClient implements AnalyticsClient {
  readonly attempts: ReferralEventRecord[] = [];
  readonly events: ReferralEventRecord[] = [];
  readonly failingEvents = new Set<ReferralEventName>();

  constructor(private readonly operations: string[]) {}

  async logEvent(event: ReferralEventRecord): Promise<void> {
    this.operations.push(`analytics:${event.name}`);
    this.attempts.push(event);
    if (this.failingEvents.has(event.name)) throw new Error('Analytics unavailable');
    this.events.push(event);
  }
}

class FakeDeepLinkService implements DeepLinkService {
  readonly mode = 'web-demo' as const;
  createError: Error | undefined;
  createdUrl: string | undefined;
  subscribeError: Error | undefined;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  private listener: ((event: RawDeepLinkEvent) => void) | undefined;

  async createReferralLink(referralCode: string): Promise<string> {
    if (this.createError) throw this.createError;
    return this.createdUrl ?? `https://mal.test-app.link/r/${referralCode}`;
  }

  subscribe(listener: (event: RawDeepLinkEvent) => void): () => void {
    this.subscribeCalls += 1;
    if (this.subscribeError) throw this.subscribeError;
    this.listener = listener;
    return () => {
      this.unsubscribeCalls += 1;
      this.listener = undefined;
    };
  }

  simulate(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void {
    this.listener?.(validBranchEvent(kind === 'deferred', kind === 'invalid' ? 'BAD-CODE' : referralCode));
  }

  emit(event: RawDeepLinkEvent): void {
    this.listener?.(event);
  }
}

class FakeReferralApi implements MockReferralApi {
  readonly acceptedReferrals: { code: string; email: string; idempotencyKey: string }[] = [];
  generatedCode = CODE_A;
  acceptError: Error | undefined;

  async getOrCreateCode(): Promise<string> {
    return this.generatedCode;
  }

  async acceptReferral(
    code: string,
    email: string,
    idempotencyKey: string,
  ): Promise<{ accountId: string }> {
    this.acceptedReferrals.push({ code, email, idempotencyKey });
    if (this.acceptError) throw this.acceptError;
    return { accountId: 'acct_test_123' };
  }
}

class FakeShareService implements ShareService {
  result: ShareResult = { status: 'shared', channel: 'native-share' };
  thrownError: Error | undefined;

  async shareReferral(): Promise<ShareResult> {
    if (this.thrownError) throw this.thrownError;
    return this.result;
  }
}

interface Harness {
  coordinator: ReferralCoordinator;
  storage: MemoryStorage;
  analyticsClient: MemoryAnalyticsClient;
  deepLinks: FakeDeepLinkService;
  referralApi: FakeReferralApi;
  shareService: FakeShareService;
  operations: string[];
}

function createHarness(): Harness {
  const operations: string[] = [];
  const storage = new MemoryStorage(operations);
  const analyticsClient = new MemoryAnalyticsClient(operations);
  const analytics = new AnalyticsTracker(analyticsClient, storage, 'android', () => FIXED_NOW);
  const deepLinks = new FakeDeepLinkService();
  const referralApi = new FakeReferralApi();
  const shareService = new FakeShareService();
  const coordinator = new ReferralCoordinator(
    deepLinks,
    analytics,
    storage,
    referralApi,
    shareService,
    'android',
  );
  return {
    coordinator,
    storage,
    analyticsClient,
    deepLinks,
    referralApi,
    shareService,
    operations,
  };
}

function validBranchEvent(deferred = false, referralCode = CODE_A): RawDeepLinkEvent {
  return {
    uri: `https://mal.test-app.link/r/${referralCode}`,
    params: {
      '+clicked_branch_link': true,
      '+is_first_session': deferred,
      '+click_timestamp': '1774958400',
      $deeplink_path: REFERRAL_DESTINATION,
      referral_code: referralCode,
    },
  };
}

function attributionFor(referralCode = CODE_A, deferred = false): ReferralAttribution {
  const parsed = parseReferralAttribution(validBranchEvent(deferred, referralCode), () => FIXED_NOW);
  if (parsed.status !== 'accepted') throw new Error('Test setup did not produce an attribution');
  return parsed.attribution;
}

function eventsNamed(client: MemoryAnalyticsClient, name: ReferralEventName): ReferralEventRecord[] {
  return client.events.filter((event) => event.name === name);
}

async function settleAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ReferralCoordinator', () => {
  it.each([
    { deferred: false, kind: 'direct', firstSession: false },
    { deferred: true, kind: 'deferred', firstSession: true },
  ] as const)(
    'accepts, tracks, and routes a valid $kind attribution',
    async ({ deferred, kind, firstSession }) => {
      const { coordinator, analyticsClient } = createHarness();
      const navigated: ReferralAttribution[] = [];
      coordinator.setNavigator((attribution) => navigated.push(attribution));

      await coordinator.handleDeepLink(validBranchEvent(deferred));

      expect(navigated).toHaveLength(1);
      expect(navigated[0]).toMatchObject({ referralCode: CODE_A, kind });
      expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
      expect(eventsNamed(analyticsClient, 'referral_link_clicked')[0]?.properties).toMatchObject({
        referral_code: CODE_A,
        platform: 'android',
        attribution_kind: kind,
        is_first_session: firstSession,
      });
    },
  );

  it('persists an accepted attribution before analytics and routing', async () => {
    const { coordinator, storage, operations } = createHarness();
    let pendingAtRoute: Promise<ReferralAttribution | null> | undefined;
    coordinator.setNavigator(() => {
      pendingAtRoute = storage.getPendingAttribution();
      operations.push('navigation:referral-onboarding');
    });

    await coordinator.handleDeepLink(validBranchEvent());

    const saveIndex = operations.indexOf('storage:save-pending');
    const analyticsIndex = operations.indexOf('analytics:referral_link_clicked');
    const routeIndex = operations.indexOf('navigation:referral-onboarding');
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(analyticsIndex).toBeGreaterThan(saveIndex);
    expect(routeIndex).toBeGreaterThan(analyticsIndex);
    await expect(pendingAtRoute).resolves.toMatchObject({ referralCode: CODE_A });
  });

  it.each([
    {
      label: 'missing code',
      event: {
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: REFERRAL_DESTINATION,
        },
      },
      reason: 'missing_code',
      rejectionEventCount: 1,
    },
    {
      label: 'invalid code',
      event: validBranchEvent(false, 'BAD-CODE'),
      reason: 'invalid_code',
      rejectionEventCount: 1,
    },
    {
      label: 'unsupported destination',
      event: {
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: 'payments/transfer',
          referral_code: CODE_A,
        },
      },
      reason: 'unsupported_destination',
      rejectionEventCount: 0,
    },
  ])('rejects $label without persisting or routing', async ({ event, reason, rejectionEventCount }) => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    await coordinator.handleDeepLink(event);

    expect(navigated).toHaveLength(0);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    expect(eventsNamed(analyticsClient, 'referral_deeplink_resolution_failed')[0]?.properties.reason).toBe(
      reason,
    );
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(rejectionEventCount);
  });

  it('suppresses duplicate click analytics while recording the replay', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    const event = validBranchEvent();

    await coordinator.handleDeepLink(event);
    await coordinator.handleDeepLink(event);

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')[0]?.properties).toMatchObject({
      referral_code: CODE_A,
      platform: 'android',
      reason: 'callback_replayed',
    });
    expect(storage.processedAttributions.size).toBe(1);
    expect(navigated).toHaveLength(1);
  });

  it('serializes concurrent duplicate callbacks into one click and one route', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    const event = validBranchEvent();

    await Promise.all([
      coordinator.handleDeepLink(event),
      coordinator.handleDeepLink(event),
      coordinator.handleDeepLink(event),
    ]);

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')).toHaveLength(2);
    expect(storage.processedAttributions.size).toBe(1);
    expect(navigated).toHaveLength(1);
  });

  it('isolates distinct concurrent codes and leaves the newest pending before signup', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    await Promise.all([
      coordinator.handleDeepLink(validBranchEvent(false, CODE_A)),
      coordinator.handleDeepLink(validBranchEvent(false, CODE_B)),
    ]);

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(2);
    expect(
      eventsNamed(analyticsClient, 'referral_link_clicked').map(
        ({ properties }) => properties.referral_code,
      ),
    ).toEqual([CODE_A, CODE_B]);
    await expect(storage.getPendingAttribution()).resolves.toMatchObject({
      referralCode: CODE_B,
    });
    expect(navigated.map(({ referralCode }) => referralCode)).toEqual([CODE_A, CODE_B]);
  });

  it('emits the complete required funnel with common analytics properties', async () => {
    const { coordinator, analyticsClient, referralApi, storage } = createHarness();
    const generated = await coordinator.generateReferral('authenticated-user-1');
    await coordinator.shareReferral(generated);
    await coordinator.handleDeepLink(validBranchEvent());
    const attribution = attributionFor();
    await coordinator.beginSignup(CODE_A, attribution);
    const result = await coordinator.completeSignup(CODE_A, 'new.user@example.com', attribution);

    expect(analyticsClient.events.map((event) => event.name)).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_link_clicked',
      'referral_signup_started',
      'referral_signup_completed',
    ]);
    for (const event of analyticsClient.events) {
      expect(event.properties).toMatchObject({
        referral_code: CODE_A,
        platform: 'android',
        occurred_at_utc: FIXED_NOW.toISOString(),
        schema_version: 1,
        app_version: '1.0.0',
      });
      expect(event.properties.event_id).toMatch(/^evt_[a-z0-9]{7}$/);
      expect(event.properties.flow_id).toBeTruthy();
    }
    expect(eventsNamed(analyticsClient, 'referral_link_shared')[0]?.properties.share_channel).toBe(
      'native-share',
    );
    expect(referralApi.acceptedReferrals).toEqual([
      {
        code: CODE_A,
        email: 'new.user@example.com',
        idempotencyKey: `signup:${attribution.fingerprint}`,
      },
    ]);
    expect(result).toEqual({ accountId: 'acct_test_123', referralCode: CODE_A });
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    await expect(storage.getFrozenReferralCode()).resolves.toBeNull();
  });

  it('records deliberate repeat shares as distinct user attempts', async () => {
    const { coordinator, analyticsClient } = createHarness();
    const generated = await coordinator.generateReferral('authenticated-user-1');

    await coordinator.shareReferral(generated);
    await coordinator.shareReferral(generated);

    const shares = eventsNamed(analyticsClient, 'referral_link_shared');
    expect(shares).toHaveLength(2);
    expect(shares[0]?.properties.event_id).not.toBe(shares[1]?.properties.event_id);
    expect(shares[0]?.properties.flow_id).not.toBe(shares[1]?.properties.flow_id);
  });

  it.each([
    {
      label: 'cancelled',
      result: { status: 'cancelled' } as ShareResult,
      expectedEvent: 'referral_link_share_cancelled' as const,
    },
    {
      label: 'failed',
      result: { status: 'failed', reason: 'chooser included sensitive detail' } as ShareResult,
      expectedEvent: 'referral_link_share_failed' as const,
    },
  ])('does not count a $label share as shared', async ({ result, expectedEvent }) => {
    const { coordinator, shareService, analyticsClient } = createHarness();
    shareService.result = result;

    await expect(
      coordinator.shareReferral({ referralCode: CODE_A, url: 'https://mal.test/r' }),
    ).resolves.toEqual(result);
    expect(eventsNamed(analyticsClient, 'referral_link_shared')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, expectedEvent)).toHaveLength(1);
    expect(JSON.stringify(analyticsClient.events)).not.toContain('sensitive detail');
  });

  it('converts a rejected share provider promise into an observable failed result', async () => {
    const { coordinator, shareService, analyticsClient } = createHarness();
    shareService.thrownError = new Error('chooser unavailable');

    await expect(
      coordinator.shareReferral({ referralCode: CODE_A, url: 'https://mal.test/r' }),
    ).resolves.toEqual({ status: 'failed', reason: 'chooser unavailable' });
    expect(eventsNamed(analyticsClient, 'referral_link_share_failed')).toHaveLength(1);
  });

  it('freezes the referral code at signup start and ignores later code substitution', async () => {
    const { coordinator, referralApi, analyticsClient, storage } = createHarness();
    const attribution = attributionFor(CODE_A);
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((nextAttribution) => navigated.push(nextAttribution));

    await expect(coordinator.beginSignup(CODE_A, attribution)).resolves.toBe(CODE_A);
    await coordinator.handleDeepLink(validBranchEvent(false, CODE_B));
    const result = await coordinator.completeSignup(CODE_B, 'new.user@example.com', attribution);

    expect(navigated).toHaveLength(0);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')[0]?.properties).toMatchObject({
      referral_code: CODE_B,
      reason: 'signup_referral_already_frozen',
    });
    expect(referralApi.acceptedReferrals[0]?.code).toBe(CODE_A);
    expect(result.referralCode).toBe(CODE_A);
    expect(eventsNamed(analyticsClient, 'referral_signup_completed')[0]?.properties.referral_code).toBe(
      CODE_A,
    );
  });

  it('retains recovery state and logs failure when signup completion fails', async () => {
    const { coordinator, referralApi, storage, analyticsClient } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    referralApi.acceptError = new Error('Referral endpoint unavailable');

    await expect(
      coordinator.completeSignup(CODE_B, 'new.user@example.com', attribution),
    ).rejects.toThrow('Referral endpoint unavailable');

    await expect(storage.getPendingAttribution()).resolves.toMatchObject({ referralCode: CODE_A });
    await expect(storage.getFrozenReferralCode()).resolves.toBe(CODE_A);
    expect(eventsNamed(analyticsClient, 'referral_signup_completed')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')[0]?.properties).toMatchObject({
      referral_code: CODE_A,
      platform: 'android',
      attribution_kind: 'direct',
      reason: 'referral_acceptance_failed',
    });
  });

  it('keeps a pending referral retryable when click analytics delivery fails', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    analyticsClient.failingEvents.add('referral_link_clicked');

    await coordinator.handleDeepLink(validBranchEvent());

    await expect(storage.getPendingAttribution()).resolves.toMatchObject({ referralCode: CODE_A });
    expect(storage.processedAttributions.size).toBe(0);
    expect(navigated).toHaveLength(1);
    expect(analyticsClient.attempts.map((event) => event.name)).toContain('referral_link_clicked');
  });

  it('logs generation failure with a referral code and platform context', async () => {
    const { coordinator, deepLinks, analyticsClient } = createHarness();
    deepLinks.createError = new Error('Branch unavailable');

    await expect(coordinator.generateReferral('authenticated-user-1')).rejects.toThrow(
      'Branch unavailable',
    );

    expect(eventsNamed(analyticsClient, 'referral_link_generation_failed')[0]?.properties).toMatchObject(
      {
        referral_code: CODE_A,
        platform: 'android',
        reason: 'link_generation_failed',
      },
    );
  });

  it('suppresses a new same-code callback after signup has already frozen attribution', async () => {
    const { coordinator, analyticsClient } = createHarness();
    const attribution = attributionFor();
    await coordinator.beginSignup(CODE_A, attribution);

    await coordinator.handleDeepLink(validBranchEvent());

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')[0]?.properties.reason).toBe(
      'signup_already_started',
    );
  });

  it('rejects starting another attribution when a different code is already frozen', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    await storage.freezeReferralCode(CODE_B);

    await expect(coordinator.beginSignup(CODE_A, attributionFor(CODE_A))).rejects.toThrow(
      'Another referral is already attached',
    );
    expect(eventsNamed(analyticsClient, 'referral_signup_started')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(1);
  });

  it('rejects unauthenticated generation and unusable provider URLs without success events', async () => {
    const { coordinator, deepLinks, analyticsClient } = createHarness();

    await expect(coordinator.generateReferral('  ')).rejects.toThrow(
      'Authenticated member identity is required.',
    );
    deepLinks.createdUrl = 'http://insecure.example/referral';
    await expect(coordinator.generateReferral('authenticated-user-1')).rejects.toThrow(
      'unusable URL',
    );

    expect(eventsNamed(analyticsClient, 'referral_link_generated')).toHaveLength(0);
    expect(
      eventsNamed(analyticsClient, 'referral_link_generation_failed').map(
        ({ properties }) => properties.reason,
      ),
    ).toEqual(['authentication_required', 'invalid_generated_url']);
  });

  it('coalesces concurrent generation for the same authenticated member', async () => {
    const { coordinator, analyticsClient } = createHarness();

    const [first, second] = await Promise.all([
      coordinator.generateReferral('authenticated-user-1'),
      coordinator.generateReferral('authenticated-user-1'),
    ]);

    expect(second).toEqual(first);
    expect(eventsNamed(analyticsClient, 'referral_link_generated')).toHaveLength(1);
  });

  it('buffers a restored cold-start route until navigation is ready and unsubscribes cleanly', async () => {
    const { coordinator, storage, deepLinks } = createHarness();
    const pending = attributionFor(CODE_A, true);
    await storage.savePendingAttribution(pending);

    coordinator.start();
    coordinator.start();
    await settleAsyncWork();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    expect(navigated).toEqual([pending]);
    expect(deepLinks.subscribeCalls).toBe(1);
    coordinator.stop();
    coordinator.stop();
    expect(deepLinks.unsubscribeCalls).toBe(1);
    deepLinks.emit(validBranchEvent(false, CODE_B));
    await settleAsyncWork();
    expect(navigated).toHaveLength(1);
  });

  it('processes a subscribed warm callback and reports subscription setup failure', async () => {
    const warm = createHarness();
    const navigated: ReferralAttribution[] = [];
    warm.coordinator.setNavigator((attribution) => navigated.push(attribution));
    warm.coordinator.start();
    warm.deepLinks.emit(validBranchEvent());
    await settleAsyncWork();
    expect(navigated).toHaveLength(1);

    const failed = createHarness();
    failed.deepLinks.subscribeError = new Error('native module unavailable');
    failed.coordinator.start();
    await settleAsyncWork();
    expect(
      eventsNamed(failed.analyticsClient, 'referral_deeplink_resolution_failed')[0]
        ?.properties.reason,
    ).toBe('subscription_failed');
  });

  it('does not replay a buffered attribution after reset', async () => {
    const { coordinator } = createHarness();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.resetDemoState();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    expect(navigated).toHaveLength(0);
  });

  it('coalesces concurrent completion into one backend acceptance', async () => {
    const { coordinator, referralApi } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);

    const [first, second] = await Promise.all([
      coordinator.completeSignup(CODE_A, 'new.user@example.com', attribution),
      coordinator.completeSignup(CODE_A, 'new.user@example.com', attribution),
    ]);

    expect(second).toEqual(first);
    expect(referralApi.acceptedReferrals).toHaveLength(1);
  });

  it('rejects completion before signup starts without calling the backend', async () => {
    const { coordinator, referralApi, analyticsClient } = createHarness();

    await expect(
      coordinator.completeSignup(CODE_A, 'new.user@example.com', attributionFor()),
    ).rejects.toThrow('Signup must start');
    expect(referralApi.acceptedReferrals).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')[0]?.properties.reason).toBe(
      'signup_not_started',
    );
  });

  it('reports callback and pending-restore persistence failures from start', async () => {
    const callback = createHarness();
    callback.storage.savePendingError = new Error('storage write failed');
    callback.coordinator.start();
    callback.deepLinks.emit(validBranchEvent());
    await settleAsyncWork();
    expect(
      eventsNamed(callback.analyticsClient, 'referral_deeplink_resolution_failed').map(
        ({ properties }) => properties.reason,
      ),
    ).toContain('callback_processing_failed');

    const restore = createHarness();
    restore.storage.getPendingError = new Error('storage read failed');
    restore.coordinator.start();
    await settleAsyncWork();
    expect(
      eventsNamed(restore.analyticsClient, 'referral_deeplink_resolution_failed').map(
        ({ properties }) => properties.reason,
      ),
    ).toContain('pending_restore_failed');
  });

  it('exposes integration metadata and delegates reviewer simulation', async () => {
    const { coordinator, analyticsClient } = createHarness();
    coordinator.start();

    expect(coordinator.integrationMode).toBe('web-demo');
    expect(coordinator.platformName).toBe('android');
    coordinator.simulateLink('invalid', CODE_A);
    await settleAsyncWork();
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(1);
  });

  it('rejects a mismatched code before signup freeze', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const attribution = attributionFor(CODE_A);

    await expect(coordinator.beginSignup(CODE_B, attribution)).rejects.toThrow(
      'does not match',
    );
    await expect(storage.getFrozenReferralCode()).resolves.toBeNull();
    expect(eventsNamed(analyticsClient, 'referral_signup_started')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(1);
  });

  it('regresses reset into fresh generate/share/deferred, direct, and invalid journeys', async () => {
    const { coordinator, referralApi, analyticsClient, storage } = createHarness();
    const initial = await coordinator.generateReferral('authenticated-user-1');
    await coordinator.shareReferral(initial);
    await coordinator.handleDeepLink(validBranchEvent(false, initial.referralCode));
    const initialAttribution = attributionFor(initial.referralCode);
    await coordinator.beginSignup(initial.referralCode, initialAttribution);
    await coordinator.completeSignup(
      initial.referralCode,
      'first@example.com',
      initialAttribution,
    );

    await coordinator.resetDemoState();
    const ledgerStart = analyticsClient.events.length;
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    referralApi.generatedCode = CODE_B;
    const generated = await coordinator.generateReferral('authenticated-user-1');
    await coordinator.shareReferral(generated);
    const deferredEvent = validBranchEvent(true, generated.referralCode);
    await coordinator.handleDeepLink(deferredEvent);

    expect(generated.referralCode).toBe(CODE_B);
    expect(navigated.at(-1)).toMatchObject({
      referralCode: generated.referralCode,
      kind: 'deferred',
    });
    await expect(storage.getPendingAttribution()).resolves.toMatchObject({
      referralCode: generated.referralCode,
      kind: 'deferred',
    });
    expect(
      analyticsClient.events.slice(ledgerStart).map(({ name }) => name),
    ).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_link_clicked',
    ]);

    await coordinator.resetDemoState();
    const directStart = analyticsClient.events.length;
    await coordinator.handleDeepLink(validBranchEvent(false, CODE_A));
    expect(navigated.at(-1)).toMatchObject({ referralCode: CODE_A, kind: 'direct' });
    expect(analyticsClient.events.slice(directStart).map(({ name }) => name)).toEqual([
      'referral_link_clicked',
    ]);
    await expect(storage.getPendingAttribution()).resolves.toMatchObject({
      referralCode: CODE_A,
      kind: 'direct',
    });

    await coordinator.resetDemoState();
    const invalidStart = analyticsClient.events.length;
    await coordinator.handleDeepLink(validBranchEvent(false, 'BAD-CODE'));
    expect(navigated).toHaveLength(2);
    expect(analyticsClient.events.slice(invalidStart).map(({ name }) => name)).toEqual([
      'referral_deeplink_resolution_failed',
      'referral_code_rejected',
    ]);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
  });
});
