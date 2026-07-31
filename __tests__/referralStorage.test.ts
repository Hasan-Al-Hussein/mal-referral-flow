import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { referralStorage } from '../src/services/storage/referralStorage';

import type { ReferralEventRecord } from '../src/domain/analytics';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const PENDING_KEY = '@mal-referral/pending-attribution';
const MILESTONES_KEY = '@mal-referral/analytics-milestones';
const PROCESSED_KEY = '@mal-referral/processed-attributions';
const OUTBOX_KEY = '@mal-referral/analytics-outbox';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

function event(eventId: string): ReferralEventRecord {
  return {
    name: 'referral_link_clicked',
    properties: {
      referral_code: 'MAL-ABCD2345',
      platform: 'android',
      event_id: eventId,
      flow_id: 'invitee:abc1234',
      occurred_at_utc: new Date().toISOString(),
      schema_version: 1,
      app_version: '1.0.0',
    },
  };
}

describe('referralStorage', () => {
  it('removes malformed or stale persisted attribution instead of routing it', async () => {
    await AsyncStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ referralCode: 'email@example.com' }),
    );
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();

    await AsyncStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        referralCode: 'MAL-ABCD2345',
        destination: 'onboarding/referral',
        kind: 'deferred',
        fingerprint: 'abc1234',
        receivedAt: '2020-01-01T00:00:00.000Z',
      }),
    );
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
  });

  it('serializes concurrent bounded-set writes without losing unrelated receipts', async () => {
    await Promise.all([
      referralStorage.markAttributionProcessed('fingerprint-a'),
      referralStorage.markAttributionProcessed('fingerprint-b'),
      referralStorage.markMilestone('flow-a:clicked'),
      referralStorage.markMilestone('flow-b:clicked'),
    ]);

    expect(JSON.parse((await AsyncStorage.getItem(PROCESSED_KEY)) ?? '[]')).toEqual([
      'fingerprint-a',
      'fingerprint-b',
    ]);
    expect(JSON.parse((await AsyncStorage.getItem(MILESTONES_KEY)) ?? '[]')).toEqual([
      'flow-a:clicked',
      'flow-b:clicked',
    ]);
  });

  it('deduplicates outbox event IDs, filters poisoned entries, and removes delivered events', async () => {
    await referralStorage.savePendingAnalyticsEvent(event('evt_abc1234'));
    await referralStorage.savePendingAnalyticsEvent(event('evt_abc1234'));
    await AsyncStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([
        ...JSON.parse((await AsyncStorage.getItem(OUTBOX_KEY)) ?? '[]'),
        { name: 'not_allowed', properties: { referral_code: 'email@example.com' } },
        {
          ...event('evt_poison1'),
          properties: {
            ...event('evt_poison1').properties,
            email: 'reviewer@example.com',
          },
        },
      ]),
    );

    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toHaveLength(1);
    await referralStorage.removePendingAnalyticsEvent('evt_abc1234');
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([]);
  });

  it('resets referral journey state and receipts while retaining the stable member code', async () => {
    await referralStorage.setGeneratedCode('member-1', 'MAL-ABCD2345');
    await referralStorage.freezeReferralCode('MAL-ABCD2345');
    await referralStorage.markAttributionProcessed('fingerprint-a');
    await referralStorage.markMilestone('flow-a:clicked');
    await referralStorage.savePendingAnalyticsEvent(event('evt_abc1234'));
    await referralStorage.saveSignupReceipt('signup:abc1234', {
      accountId: 'acct_abc1234',
      referralCode: 'MAL-ABCD2345',
    });

    await referralStorage.resetDemoState();

    await expect(referralStorage.getGeneratedCode('member-1')).resolves.toBe(
      'MAL-ABCD2345',
    );
    await expect(referralStorage.getFrozenReferralCode()).resolves.toBeNull();
    await expect(referralStorage.hasProcessedAttribution('fingerprint-a')).resolves.toBe(false);
    await expect(referralStorage.hasMilestone('flow-a:clicked')).resolves.toBe(false);
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([]);
    await expect(referralStorage.getSignupReceipt('signup:abc1234')).resolves.toBeNull();
  });
});
