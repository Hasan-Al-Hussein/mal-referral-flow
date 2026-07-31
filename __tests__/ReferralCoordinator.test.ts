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
import type { ReferralStorage } from '../src/services/storage/referralStorage';

const CODE_A = 'MAL-ABCD2345';
const CODE_B = 'MAL-ZYXW9876';
const FIXED_NOW = new Date('2026-07-31T12:00:00.000Z');

class MemoryStorage implements ReferralStorage {
  readonly operations: string[];
  readonly processedAttributions = new Set<string>();
  readonly milestones = new Set<string>();
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
    return this.pendingAttribution;
  }

  async savePendingAttribution(attribution: ReferralAttribution): Promise<void> {
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

  async resetDemoState(): Promise<void> {
    this.pendingAttribution = null;
    this.frozenReferralCode = null;
    this.processedAttributions.clear();
    this.milestones.clear();
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
  private listener: ((event: RawDeepLinkEvent) => void) | undefined;

  async createReferralLink(referralCode: string): Promise<string> {
    if (this.createError) throw this.createError;
    return `https://mal.test-app.link/r/${referralCode}`;
  }

  subscribe(listener: (event: RawDeepLinkEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  simulate(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void {
    this.listener?.(validBranchEvent(kind === 'deferred', kind === 'invalid' ? 'BAD-CODE' : referralCode));
  }
}

class FakeReferralApi implements MockReferralApi {
  readonly acceptedReferrals: { code: string; email: string }[] = [];
  generatedCode = CODE_A;
  acceptError: Error | undefined;

  async getOrCreateCode(): Promise<string> {
    return this.generatedCode;
  }

  async acceptReferral(code: string, email: string): Promise<{ accountId: string }> {
    this.acceptedReferrals.push({ code, email });
    if (this.acceptError) throw this.acceptError;
    return { accountId: 'acct_test_123' };
  }
}

class FakeShareService implements ShareService {
  result: ShareResult = { status: 'shared', channel: 'native-share' };

  async shareReferral(): Promise<ShareResult> {
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
      { code: CODE_A, email: 'new.user@example.com' },
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
      reason: 'Referral endpoint unavailable',
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
        reason: 'Branch unavailable',
      },
    );
  });
});
