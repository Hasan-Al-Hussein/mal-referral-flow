import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { REFERRAL_DESTINATION } from '../src/domain/referral';
import { referralStorage } from '../src/services/storage/referralStorage';

import type { ReferralEventRecord } from '../src/domain/analytics';
import type { ReferralAttribution } from '../src/domain/referral';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-crypto', () => {
  let sequence = 0;
  return {
    randomUUID: () => {
      sequence += 1;
      return sequence.toString(16).padStart(32, '0');
    },
  };
});

const ACTIVE_EPOCH_KEY = '@mal-referral/active-epoch';
const JOURNEY_PREFIX = '@mal-referral/journey';
const CODE = 'MAL-ABCD2345';

function attribution(
  referralCode = CODE,
  fingerprint = 'abc1234',
  receivedAt = new Date().toISOString(),
): ReferralAttribution {
  return {
    referralCode,
    destination: REFERRAL_DESTINATION,
    kind: 'deferred',
    fingerprint,
    receivedAt,
  };
}

function event(
  eventId = 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  flowId = 'invitee:abc1234',
): ReferralEventRecord {
  return {
    name: 'referral_link_clicked',
    properties: {
      referral_code: CODE,
      platform: 'android',
      event_id: eventId,
      flow_id: flowId,
      occurred_at_utc: new Date().toISOString(),
      schema_version: 1,
      app_version: '1.0.0',
    },
  };
}

async function currentJourneyKey(): Promise<string> {
  const epoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
  if (!epoch) throw new Error('Test epoch was not initialized');
  return `${JOURNEY_PREFIX}:${epoch}`;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await referralStorage.resetDemoState();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('referralStorage', () => {
  it('removes malformed and stale pending or frozen attribution as one journey record', async () => {
    const key = await currentJourneyKey();
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        pending: { referralCode: 'email@example.com' },
        frozen: attribution(CODE, 'stale001', '2020-01-01T00:00:00.000Z'),
      }),
    );

    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(referralStorage.getFrozenAttribution()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(key)).resolves.toBeNull();

    const fresh = attribution(CODE, 'frsh001');
    await referralStorage.savePendingAttribution(fresh);
    await referralStorage.freezeAttribution(fresh);
    await expect(referralStorage.getFrozenAttribution()).resolves.toEqual(fresh);
  });

  it('serializes invalid cleanup with a concurrent valid write so cleanup cannot delete it', async () => {
    const key = await currentJourneyKey();
    await AsyncStorage.setItem(key, JSON.stringify({ pending: { referralCode: 'invalid' } }));
    const originalGetItem = jest.mocked(AsyncStorage.getItem).getMockImplementation();
    if (!originalGetItem) throw new Error('AsyncStorage getItem mock is unavailable');
    const readStarted = deferred();
    const releaseRead = deferred();
    let gated = false;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (storageKey) => {
      if (storageKey === key && !gated) {
        gated = true;
        readStarted.resolve();
        await releaseRead.promise;
      }
      return originalGetItem(storageKey);
    });

    const invalidRead = referralStorage.getPendingAttribution();
    await readStarted.promise;
    const fresh = attribution(CODE, 'frsh002');
    const concurrentWrite = referralStorage.savePendingAttribution(fresh);
    releaseRead.resolve();

    await expect(invalidRead).resolves.toBeNull();
    await concurrentWrite;
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(fresh);
  });

  it('keeps pending and frozen identity together when atomic completion cleanup fails', async () => {
    const journey = attribution();
    await referralStorage.savePendingAttribution(journey);
    await referralStorage.freezeAttribution(journey);
    const key = await currentJourneyKey();
    const originalRemove = jest.mocked(AsyncStorage.removeItem).getMockImplementation();
    if (!originalRemove) throw new Error('AsyncStorage removeItem mock is unavailable');
    let failOnce = true;
    jest.spyOn(AsyncStorage, 'removeItem').mockImplementation(async (storageKey) => {
      if (storageKey === key && failOnce) {
        failOnce = false;
        throw new Error('injected cleanup failure');
      }
      return originalRemove(storageKey);
    });

    await expect(referralStorage.completeReferralJourney(journey)).rejects.toThrow(
      'injected cleanup failure',
    );
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(journey);
    await expect(referralStorage.getFrozenAttribution()).resolves.toEqual(journey);

    await referralStorage.completeReferralJourney(journey);
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(referralStorage.getFrozenAttribution()).resolves.toBeNull();
  });

  it('serializes concurrent bounded-set writes without losing unrelated values', async () => {
    await Promise.all([
      referralStorage.markAttributionProcessed('fingerprint-a'),
      referralStorage.markAttributionProcessed('fingerprint-b'),
      referralStorage.markMilestone('flow-a:clicked', event(undefined, 'flow-a')),
      referralStorage.markMilestone(
        'flow-b:clicked',
        event('evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'flow-b'),
      ),
    ]);

    await expect(referralStorage.hasProcessedAttribution('fingerprint-a')).resolves.toBe(true);
    await expect(referralStorage.hasProcessedAttribution('fingerprint-b')).resolves.toBe(true);
    await expect(referralStorage.hasMilestone('flow-a:clicked')).resolves.toBe(true);
    await expect(referralStorage.hasMilestone('flow-b:clicked')).resolves.toBe(true);
    await expect(referralStorage.getAcceptedAnalyticsEvents()).resolves.toHaveLength(2);
  });

  it('reserves one stable outbox event per milestone and filters poisoned entries', async () => {
    const first = event();
    const retryCandidate = event(
      'evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      first.properties.flow_id,
    );
    await expect(referralStorage.reservePendingAnalyticsEvent(first)).resolves.toEqual(first);
    await expect(
      referralStorage.reservePendingAnalyticsEvent(retryCandidate),
    ).resolves.toEqual(first);

    const outboxKey = (await AsyncStorage.getAllKeys()).find((key) =>
      key.startsWith('@mal-referral/analytics-outbox:'),
    );
    if (!outboxKey) throw new Error('Outbox key was not created');
    await AsyncStorage.setItem(
      outboxKey,
      JSON.stringify([
        first,
        { name: 'not_allowed', properties: { referral_code: 'email@example.com' } },
      ]),
    );

    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([first]);
    await referralStorage.removePendingAnalyticsEvent(first.properties.event_id);
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([]);
  });

  it('atomically creates one canonical signup receipt and rejects a conflicting code', async () => {
    const receipt = { accountId: 'acct_abc1234', referralCode: CODE };
    const [first, second] = await Promise.all([
      referralStorage.createSignupReceipt('signup:abc1234', receipt),
      referralStorage.createSignupReceipt('signup:abc1234', receipt),
    ]);
    expect(first).toEqual(receipt);
    expect(second).toEqual(receipt);
    await expect(
      referralStorage.createSignupReceipt('signup:abc1234', {
        accountId: 'acct_def5678',
        referralCode: 'MAL-ZYXW9876',
      }),
    ).rejects.toThrow('conflicts with another referral');
  });

  it('switches epoch before cleanup so a delayed old write cannot restore reset state', async () => {
    const oldJourneyKey = await currentJourneyKey();
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    const writeStarted = deferred();
    const releaseWrite = deferred();
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (storageKey, value) => {
      if (storageKey === oldJourneyKey) {
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      return originalSet(storageKey, value);
    });

    const oldWrite = referralStorage.savePendingAttribution(attribution(CODE, 'old0001'));
    await writeStarted.promise;
    await referralStorage.resetDemoState();
    const fresh = attribution('MAL-ZYXW9876', 'new0001');
    await referralStorage.savePendingAttribution(fresh);
    releaseWrite.resolve();
    await oldWrite;

    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(fresh);
    expect(await currentJourneyKey()).not.toBe(oldJourneyKey);
  });

  it('resets every demo namespace, including generated codes and receipts', async () => {
    const journey = attribution();
    await referralStorage.setGeneratedCode('member-1', CODE);
    await referralStorage.savePendingAttribution(journey);
    await referralStorage.freezeAttribution(journey);
    await referralStorage.markAttributionProcessed('fingerprint-a');
    await referralStorage.markMilestone('flow-a:clicked', event());
    await referralStorage.reservePendingAnalyticsEvent(event());
    await referralStorage.createSignupReceipt('signup:abc1234', {
      accountId: 'acct_abc1234',
      referralCode: CODE,
    });

    await referralStorage.resetDemoState();

    await expect(referralStorage.getGeneratedCode('member-1')).resolves.toBeNull();
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(referralStorage.getFrozenAttribution()).resolves.toBeNull();
    await expect(referralStorage.hasProcessedAttribution('fingerprint-a')).resolves.toBe(false);
    await expect(referralStorage.hasMilestone('flow-a:clicked')).resolves.toBe(false);
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([]);
    await expect(referralStorage.getSignupReceipt('signup:abc1234')).resolves.toBeNull();
  });
});
