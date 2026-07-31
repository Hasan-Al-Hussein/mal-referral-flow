import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { isReferralEventRecord } from '../../domain/analytics';
import {
  isValidReferralCode,
  normalizeReferralCode,
  parseStoredReferralAttribution,
} from '../../domain/referral';

import type { ReferralEventRecord } from '../../domain/analytics';
import type { ReferralAttribution } from '../../domain/referral';

const ACTIVE_EPOCH_KEY = '@mal-referral/active-epoch';
const EPOCH_PATTERN = /^[a-f0-9]{32}$/;
const BASE_KEYS = {
  journey: '@mal-referral/journey',
  processedAttributions: '@mal-referral/processed-attributions',
  milestones: '@mal-referral/analytics-milestones',
  analyticsOutbox: '@mal-referral/analytics-outbox',
  signupReceipts: '@mal-referral/signup-receipts',
  generatedCodePrefix: '@mal-referral/generated-code',
} as const;

const pendingUpdates = new Map<string, Promise<void>>();
let activeEpochPromise: Promise<string> | undefined;
let activeEpochValue: string | undefined;
let epochGeneration = 0;

function createEpoch(): string {
  return Crypto.randomUUID().replaceAll('-', '').toLowerCase();
}

async function loadOrCreateEpoch(generation: number): Promise<string> {
  const persisted = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
  if (generation !== epochGeneration) return activeEpochValue as string;
  if (persisted && EPOCH_PATTERN.test(persisted)) {
    activeEpochValue = persisted;
    return persisted;
  }

  const created = createEpoch();
  if (generation !== epochGeneration) return activeEpochValue as string;
  await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, created);
  if (generation !== epochGeneration) {
    const current = activeEpochValue as string;
    await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, current);
    return current;
  }
  activeEpochValue = created;
  return created;
}

function captureEpoch(): Promise<string> {
  activeEpochPromise ??= loadOrCreateEpoch(epochGeneration);
  return activeEpochPromise;
}

function epochKey(baseKey: string, epoch: string): string {
  return `${baseKey}:${epoch}`;
}

function generatedCodeKey(epoch: string, userId: string): string {
  return `${BASE_KEYS.generatedCodePrefix}:${epoch}:${encodeURIComponent(userId)}`;
}

function updateSerially<T>(key: string, update: () => Promise<T>): Promise<T> {
  const previous = pendingUpdates.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(update);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  pendingUpdates.set(key, tail);
  void tail.then(() => {
    if (pendingUpdates.get(key) === tail) pendingUpdates.delete(key);
  });
  return operation;
}

function parseSet(serialized: string | null): Set<string> {
  if (!serialized) return new Set();
  try {
    const values: unknown = JSON.parse(serialized);
    return new Set(
      Array.isArray(values)
        ? values.filter(
            (item): item is string => typeof item === 'string' && item.length <= 200,
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

function readSet(epoch: Promise<string>, baseKey: string): Promise<Set<string>> {
  return epoch.then((value) => {
    const key = epochKey(baseKey, value);
    return updateSerially(key, async () => parseSet(await AsyncStorage.getItem(key)));
  });
}

function addToBoundedSet(
  epoch: Promise<string>,
  baseKey: string,
  value: string,
  limit = 200,
): Promise<void> {
  return epoch.then((epochValue) => {
    const key = epochKey(baseKey, epochValue);
    return updateSerially(key, async () => {
      const values = parseSet(await AsyncStorage.getItem(key));
      values.add(value);
      await AsyncStorage.setItem(key, JSON.stringify([...values].slice(-limit)));
    });
  });
}

interface PersistedJourney {
  pending?: ReferralAttribution;
  frozen?: ReferralAttribution;
}

function sameAttribution(
  first: ReferralAttribution,
  second: ReferralAttribution,
): boolean {
  return (
    first.referralCode === second.referralCode &&
    first.fingerprint === second.fingerprint &&
    first.receivedAt === second.receivedAt
  );
}

function parseJourney(serialized: string | null): PersistedJourney {
  if (!serialized) return {};
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const candidate = parsed as Record<string, unknown>;
    const pending = parseStoredReferralAttribution(candidate.pending);
    const frozen = parseStoredReferralAttribution(candidate.frozen);
    return {
      ...(pending ? { pending } : {}),
      ...(frozen ? { frozen } : {}),
    };
  } catch {
    return {};
  }
}

async function writeJourney(key: string, journey: PersistedJourney): Promise<void> {
  if (!journey.pending && !journey.frozen) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await AsyncStorage.setItem(key, JSON.stringify(journey));
}

function readEvents(serialized: string | null): ReferralEventRecord[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter(isReferralEventRecord) : [];
  } catch {
    return [];
  }
}

interface AcceptedAnalyticsState {
  milestoneKeys: string[];
  events: ReferralEventRecord[];
}

function readAcceptedAnalyticsState(serialized: string | null): AcceptedAnalyticsState {
  if (!serialized) return { milestoneKeys: [], events: [] };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (Array.isArray(parsed)) {
      return {
        milestoneKeys: parsed.filter(
          (item): item is string => typeof item === 'string' && item.length <= 200,
        ),
        events: [],
      };
    }
    if (!parsed || typeof parsed !== 'object') return { milestoneKeys: [], events: [] };
    const candidate = parsed as Record<string, unknown>;
    return {
      milestoneKeys: Array.isArray(candidate.milestoneKeys)
        ? candidate.milestoneKeys.filter(
            (item): item is string => typeof item === 'string' && item.length <= 200,
          )
        : [],
      events: Array.isArray(candidate.events)
        ? candidate.events.filter(isReferralEventRecord)
        : [],
    };
  } catch {
    return { milestoneKeys: [], events: [] };
  }
}

export interface ReferralAcceptanceReceipt {
  accountId: string;
  referralCode: string;
}

export interface ReferralStorage {
  getGeneratedCode(userId: string): Promise<string | null>;
  setGeneratedCode(userId: string, code: string): Promise<void>;
  getPendingAttribution(): Promise<ReferralAttribution | null>;
  savePendingAttribution(attribution: ReferralAttribution): Promise<void>;
  clearPendingAttribution(): Promise<void>;
  getFrozenAttribution(): Promise<ReferralAttribution | null>;
  freezeAttribution(attribution: ReferralAttribution): Promise<void>;
  completeReferralJourney(attribution: ReferralAttribution): Promise<void>;
  hasProcessedAttribution(fingerprint: string): Promise<boolean>;
  markAttributionProcessed(fingerprint: string): Promise<void>;
  hasMilestone(key: string): Promise<boolean>;
  markMilestone(key: string, event: ReferralEventRecord): Promise<void>;
  getAcceptedAnalyticsEvents(): Promise<ReferralEventRecord[]>;
  getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]>;
  reservePendingAnalyticsEvent(event: ReferralEventRecord): Promise<ReferralEventRecord>;
  removePendingAnalyticsEvent(eventId: string): Promise<void>;
  getSignupReceipt(idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null>;
  createSignupReceipt(
    idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<ReferralAcceptanceReceipt>;
  resetDemoState(): Promise<void>;
}

function isReferralAcceptanceReceipt(value: unknown): value is ReferralAcceptanceReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.accountId === 'string' &&
    /^acct_[a-z0-9]{7}$/.test(receipt.accountId) &&
    typeof receipt.referralCode === 'string' &&
    isValidReferralCode(receipt.referralCode) &&
    normalizeReferralCode(receipt.referralCode) === receipt.referralCode
  );
}

function parseSignupReceipts(
  serialized: string | null,
): Record<string, ReferralAcceptanceReceipt> {
  if (!serialized) return {};
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ReferralAcceptanceReceipt] =>
          entry[0].length <= 160 && isReferralAcceptanceReceipt(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export const referralStorage: ReferralStorage = {
  getGeneratedCode(userId) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = generatedCodeKey(value, userId);
      return updateSerially(key, () => AsyncStorage.getItem(key));
    });
  },
  setGeneratedCode(userId, code) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = generatedCodeKey(value, userId);
      return updateSerially(key, () => AsyncStorage.setItem(key, code));
    });
  },
  getPendingAttribution() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const serialized = await AsyncStorage.getItem(key);
        const journey = parseJourney(serialized);
        if (serialized && !journey.pending && !journey.frozen) {
          await AsyncStorage.removeItem(key);
        } else if (serialized) {
          await writeJourney(key, journey);
        }
        return journey.pending ?? null;
      });
    });
  },
  savePendingAttribution(attribution) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        await writeJourney(key, { ...journey, pending: attribution });
      });
    });
  },
  clearPendingAttribution() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        delete journey.pending;
        await writeJourney(key, journey);
      });
    });
  },
  getFrozenAttribution() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const serialized = await AsyncStorage.getItem(key);
        const journey = parseJourney(serialized);
        if (serialized) await writeJourney(key, journey);
        return journey.frozen ?? null;
      });
    });
  },
  freezeAttribution(attribution) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        if (journey.frozen && !sameAttribution(journey.frozen, attribution)) {
          throw new Error('Another referral attribution is already frozen.');
        }
        await writeJourney(key, { ...journey, frozen: attribution });
      });
    });
  },
  completeReferralJourney(attribution) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        if (!journey.frozen || !sameAttribution(journey.frozen, attribution)) {
          throw new Error('Frozen referral attribution changed before cleanup.');
        }
        await AsyncStorage.removeItem(key);
      });
    });
  },
  async hasProcessedAttribution(fingerprint) {
    const epoch = captureEpoch();
    return (await readSet(epoch, BASE_KEYS.processedAttributions)).has(fingerprint);
  },
  markAttributionProcessed(fingerprint) {
    const epoch = captureEpoch();
    return addToBoundedSet(epoch, BASE_KEYS.processedAttributions, fingerprint);
  },
  async hasMilestone(key) {
    const epoch = captureEpoch();
    const value = await epoch;
    const storageKey = epochKey(BASE_KEYS.milestones, value);
    return updateSerially(storageKey, async () =>
      readAcceptedAnalyticsState(await AsyncStorage.getItem(storageKey)).milestoneKeys.includes(
        key,
      ),
    );
  },
  markMilestone(key, event) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const storageKey = epochKey(BASE_KEYS.milestones, value);
      return updateSerially(storageKey, async () => {
        const state = readAcceptedAnalyticsState(await AsyncStorage.getItem(storageKey));
        const milestoneKeys = [...new Set([...state.milestoneKeys, key])].slice(-500);
        const events = [
          ...state.events.filter(
            (candidate) =>
              !(
                candidate.name === event.name &&
                candidate.properties.flow_id === event.properties.flow_id
              ),
          ),
          event,
        ].slice(-500);
        await AsyncStorage.setItem(storageKey, JSON.stringify({ milestoneKeys, events }));
      });
    });
  },
  getAcceptedAnalyticsEvents() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.milestones, value);
      return updateSerially(key, async () =>
        readAcceptedAnalyticsState(await AsyncStorage.getItem(key)).events,
      );
    });
  },
  getPendingAnalyticsEvents() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.analyticsOutbox, value);
      return updateSerially(key, async () => readEvents(await AsyncStorage.getItem(key)));
    });
  },
  reservePendingAnalyticsEvent(event) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.analyticsOutbox, value);
      return updateSerially(key, async () => {
        const events = readEvents(await AsyncStorage.getItem(key));
        const existing = events.find(
          (candidate) =>
            candidate.name === event.name &&
            candidate.properties.flow_id === event.properties.flow_id,
        );
        if (existing) return existing;
        const next = [...events, event].slice(-100);
        await AsyncStorage.setItem(key, JSON.stringify(next));
        return event;
      });
    });
  },
  removePendingAnalyticsEvent(eventId) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.analyticsOutbox, value);
      return updateSerially(key, async () => {
        const serialized = await AsyncStorage.getItem(key);
        if (!serialized) return;
        const events = readEvents(serialized).filter(
          ({ properties }) => properties.event_id !== eventId,
        );
        if (events.length === 0) {
          await AsyncStorage.removeItem(key);
        } else {
          await AsyncStorage.setItem(key, JSON.stringify(events));
        }
      });
    });
  },
  getSignupReceipt(idempotencyKey) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.signupReceipts, value);
      return updateSerially(key, async () => {
        const receipts = parseSignupReceipts(await AsyncStorage.getItem(key));
        return receipts[idempotencyKey] ?? null;
      });
    });
  },
  createSignupReceipt(idempotencyKey, receipt) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.signupReceipts, value);
      return updateSerially(key, async () => {
        const receipts = parseSignupReceipts(await AsyncStorage.getItem(key));
        const existing = receipts[idempotencyKey];
        if (existing) {
          if (existing.referralCode !== receipt.referralCode) {
            throw new Error('Signup idempotency key conflicts with another referral.');
          }
          return existing;
        }
        const next = Object.fromEntries(
          [...Object.entries(receipts), [idempotencyKey, receipt]].slice(-100),
        );
        await AsyncStorage.setItem(key, JSON.stringify(next));
        return receipt;
      });
    });
  },
  resetDemoState() {
    const previousEpoch = captureEpoch();
    epochGeneration += 1;
    const resetGeneration = epochGeneration;
    const nextEpoch = createEpoch();
    activeEpochValue = nextEpoch;
    activeEpochPromise = Promise.resolve(nextEpoch);

    return (async () => {
      await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, nextEpoch);
      if (resetGeneration !== epochGeneration) {
        await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, activeEpochValue as string);
      }
      const previous = await previousEpoch;
      if (previous === nextEpoch) return;
      const keys = await AsyncStorage.getAllKeys();
      const previousMarker = `:${previous}`;
      const obsoleteKeys = keys.filter(
        (key) => key.includes(previousMarker) && key.startsWith('@mal-referral/'),
      );
      if (obsoleteKeys.length > 0) await AsyncStorage.multiRemove(obsoleteKeys);
    })();
  },
};
