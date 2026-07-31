import AsyncStorage from '@react-native-async-storage/async-storage';

import { isReferralEventRecord } from '../../domain/analytics';
import {
  isValidReferralCode,
  parseStoredReferralAttribution,
} from '../../domain/referral';

import type { ReferralEventRecord } from '../../domain/analytics';
import type { ReferralAttribution } from '../../domain/referral';

const KEYS = {
  pendingAttribution: '@mal-referral/pending-attribution',
  frozenReferralCode: '@mal-referral/frozen-code',
  processedAttributions: '@mal-referral/processed-attributions',
  milestones: '@mal-referral/analytics-milestones',
  analyticsOutbox: '@mal-referral/analytics-outbox',
  signupReceipts: '@mal-referral/signup-receipts',
  generatedCodePrefix: '@mal-referral/generated-code/',
} as const;

const pendingUpdates = new Map<string, Promise<void>>();

function updateSerially(key: string, update: () => Promise<void>): Promise<void> {
  const previous = pendingUpdates.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(update);
  pendingUpdates.set(key, operation);
  void operation.then(
    () => {
      if (pendingUpdates.get(key) === operation) pendingUpdates.delete(key);
    },
    () => {
      if (pendingUpdates.get(key) === operation) pendingUpdates.delete(key);
    },
  );
  return operation;
}

async function waitForPendingUpdate(key: string): Promise<void> {
  await pendingUpdates.get(key);
}

async function readSet(key: string): Promise<Set<string>> {
  await waitForPendingUpdate(key);
  const serialized = await AsyncStorage.getItem(key);
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

function addToBoundedSet(key: string, value: string, limit = 200): Promise<void> {
  return updateSerially(key, async () => {
    const serialized = await AsyncStorage.getItem(key);
    let values = new Set<string>();
    if (serialized) {
      try {
        const parsed: unknown = JSON.parse(serialized);
        values = new Set(
          Array.isArray(parsed)
            ? parsed.filter(
                (item): item is string => typeof item === 'string' && item.length <= 200,
              )
            : [],
        );
      } catch {
        values = new Set();
      }
    }
    values.add(value);
    await AsyncStorage.setItem(key, JSON.stringify([...values].slice(-limit)));
  });
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
  getFrozenReferralCode(): Promise<string | null>;
  freezeReferralCode(code: string): Promise<void>;
  clearFrozenReferralCode(): Promise<void>;
  hasProcessedAttribution(fingerprint: string): Promise<boolean>;
  markAttributionProcessed(fingerprint: string): Promise<void>;
  hasMilestone(key: string): Promise<boolean>;
  markMilestone(key: string): Promise<void>;
  getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]>;
  savePendingAnalyticsEvent(event: ReferralEventRecord): Promise<void>;
  removePendingAnalyticsEvent(eventId: string): Promise<void>;
  getSignupReceipt(idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null>;
  saveSignupReceipt(
    idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<void>;
  resetDemoState(): Promise<void>;
}

function isReferralAcceptanceReceipt(value: unknown): value is ReferralAcceptanceReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.accountId === 'string' &&
    /^acct_[a-z0-9]{7}$/.test(receipt.accountId) &&
    isValidReferralCode(receipt.referralCode)
  );
}

async function readSignupReceipts(): Promise<Record<string, ReferralAcceptanceReceipt>> {
  await waitForPendingUpdate(KEYS.signupReceipts);
  const serialized = await AsyncStorage.getItem(KEYS.signupReceipts);
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
  async getGeneratedCode(userId) {
    const key = `${KEYS.generatedCodePrefix}${userId}`;
    await waitForPendingUpdate(key);
    return AsyncStorage.getItem(key);
  },
  setGeneratedCode(userId, code) {
    const key = `${KEYS.generatedCodePrefix}${userId}`;
    return updateSerially(key, () => AsyncStorage.setItem(key, code));
  },
  async getPendingAttribution() {
    await waitForPendingUpdate(KEYS.pendingAttribution);
    const serialized = await AsyncStorage.getItem(KEYS.pendingAttribution);
    if (!serialized) return null;
    try {
      const attribution = parseStoredReferralAttribution(JSON.parse(serialized));
      if (attribution) return attribution;
    } catch {
      // Invalid persisted input is removed below.
    }
    await updateSerially(KEYS.pendingAttribution, () =>
      AsyncStorage.removeItem(KEYS.pendingAttribution),
    );
    return null;
  },
  savePendingAttribution: (attribution) =>
    updateSerially(KEYS.pendingAttribution, () =>
      AsyncStorage.setItem(KEYS.pendingAttribution, JSON.stringify(attribution)),
    ),
  clearPendingAttribution: () =>
    updateSerially(KEYS.pendingAttribution, () =>
      AsyncStorage.removeItem(KEYS.pendingAttribution),
    ),
  async getFrozenReferralCode() {
    await waitForPendingUpdate(KEYS.frozenReferralCode);
    const code = await AsyncStorage.getItem(KEYS.frozenReferralCode);
    if (!code || isValidReferralCode(code)) return code;
    await updateSerially(KEYS.frozenReferralCode, () =>
      AsyncStorage.removeItem(KEYS.frozenReferralCode),
    );
    return null;
  },
  freezeReferralCode: (code) =>
    updateSerially(KEYS.frozenReferralCode, () =>
      AsyncStorage.setItem(KEYS.frozenReferralCode, code),
    ),
  clearFrozenReferralCode: () =>
    updateSerially(KEYS.frozenReferralCode, () =>
      AsyncStorage.removeItem(KEYS.frozenReferralCode),
    ),
  async hasProcessedAttribution(fingerprint) {
    return (await readSet(KEYS.processedAttributions)).has(fingerprint);
  },
  markAttributionProcessed: (fingerprint) =>
    addToBoundedSet(KEYS.processedAttributions, fingerprint),
  async hasMilestone(key) {
    return (await readSet(KEYS.milestones)).has(key);
  },
  markMilestone: (key) => addToBoundedSet(KEYS.milestones, key, 500),
  async getPendingAnalyticsEvents() {
    await waitForPendingUpdate(KEYS.analyticsOutbox);
    const serialized = await AsyncStorage.getItem(KEYS.analyticsOutbox);
    if (!serialized) return [];
    try {
      const parsed: unknown = JSON.parse(serialized);
      return Array.isArray(parsed) ? parsed.filter(isReferralEventRecord) : [];
    } catch {
      return [];
    }
  },
  savePendingAnalyticsEvent: (event) =>
    updateSerially(KEYS.analyticsOutbox, async () => {
      const serialized = await AsyncStorage.getItem(KEYS.analyticsOutbox);
      let events: ReferralEventRecord[] = [];
      if (serialized) {
        try {
          const parsed: unknown = JSON.parse(serialized);
          events = Array.isArray(parsed) ? parsed.filter(isReferralEventRecord) : [];
        } catch {
          events = [];
        }
      }
      const next = [
        ...events.filter(
          ({ properties }) => properties.event_id !== event.properties.event_id,
        ),
        event,
      ].slice(-100);
      await AsyncStorage.setItem(KEYS.analyticsOutbox, JSON.stringify(next));
    }),
  removePendingAnalyticsEvent: (eventId) =>
    updateSerially(KEYS.analyticsOutbox, async () => {
      const serialized = await AsyncStorage.getItem(KEYS.analyticsOutbox);
      if (!serialized) return;
      try {
        const parsed: unknown = JSON.parse(serialized);
        const events = Array.isArray(parsed) ? parsed.filter(isReferralEventRecord) : [];
        await AsyncStorage.setItem(
          KEYS.analyticsOutbox,
          JSON.stringify(
            events.filter(({ properties }) => properties.event_id !== eventId),
          ),
        );
      } catch {
        await AsyncStorage.removeItem(KEYS.analyticsOutbox);
      }
    }),
  async getSignupReceipt(idempotencyKey) {
    return (await readSignupReceipts())[idempotencyKey] ?? null;
  },
  saveSignupReceipt: (idempotencyKey, receipt) =>
    updateSerially(KEYS.signupReceipts, async () => {
      const serialized = await AsyncStorage.getItem(KEYS.signupReceipts);
      let receipts: Record<string, ReferralAcceptanceReceipt> = {};
      if (serialized) {
        try {
          const parsed: unknown = JSON.parse(serialized);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            receipts = Object.fromEntries(
              Object.entries(parsed).filter(
                (entry): entry is [string, ReferralAcceptanceReceipt] =>
                  entry[0].length <= 160 && isReferralAcceptanceReceipt(entry[1]),
              ),
            );
          }
        } catch {
          receipts = {};
        }
      }
      const next = Object.fromEntries(
        [...Object.entries(receipts), [idempotencyKey, receipt]].slice(-100),
      );
      await AsyncStorage.setItem(KEYS.signupReceipts, JSON.stringify(next));
    }),
  async resetDemoState() {
    await Promise.all(
      [
        KEYS.pendingAttribution,
        KEYS.frozenReferralCode,
        KEYS.processedAttributions,
        KEYS.milestones,
        KEYS.analyticsOutbox,
        KEYS.signupReceipts,
      ].map((key) => updateSerially(key, () => AsyncStorage.removeItem(key))),
    );
  },
};
