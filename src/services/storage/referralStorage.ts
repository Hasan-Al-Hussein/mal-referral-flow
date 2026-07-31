import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ReferralAttribution } from '../../domain/referral';

const KEYS = {
  pendingAttribution: '@mal-referral/pending-attribution',
  frozenReferralCode: '@mal-referral/frozen-code',
  processedAttributions: '@mal-referral/processed-attributions',
  milestones: '@mal-referral/analytics-milestones',
  generatedCodePrefix: '@mal-referral/generated-code/',
} as const;

async function readSet(key: string): Promise<Set<string>> {
  const serialized = await AsyncStorage.getItem(key);
  if (!serialized) return new Set();
  try {
    const values: unknown = JSON.parse(serialized);
    return new Set(Array.isArray(values) ? values.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

async function addToBoundedSet(key: string, value: string, limit = 200): Promise<void> {
  const values = await readSet(key);
  values.add(value);
  await AsyncStorage.setItem(key, JSON.stringify([...values].slice(-limit)));
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
  resetDemoState(): Promise<void>;
}

export const referralStorage: ReferralStorage = {
  getGeneratedCode: (userId) => AsyncStorage.getItem(`${KEYS.generatedCodePrefix}${userId}`),
  setGeneratedCode: (userId, code) =>
    AsyncStorage.setItem(`${KEYS.generatedCodePrefix}${userId}`, code),
  async getPendingAttribution() {
    const serialized = await AsyncStorage.getItem(KEYS.pendingAttribution);
    if (!serialized) return null;
    try {
      return JSON.parse(serialized) as ReferralAttribution;
    } catch {
      await AsyncStorage.removeItem(KEYS.pendingAttribution);
      return null;
    }
  },
  savePendingAttribution: (attribution) =>
    AsyncStorage.setItem(KEYS.pendingAttribution, JSON.stringify(attribution)),
  clearPendingAttribution: () => AsyncStorage.removeItem(KEYS.pendingAttribution),
  getFrozenReferralCode: () => AsyncStorage.getItem(KEYS.frozenReferralCode),
  freezeReferralCode: (code) => AsyncStorage.setItem(KEYS.frozenReferralCode, code),
  clearFrozenReferralCode: () => AsyncStorage.removeItem(KEYS.frozenReferralCode),
  async hasProcessedAttribution(fingerprint) {
    return (await readSet(KEYS.processedAttributions)).has(fingerprint);
  },
  markAttributionProcessed: (fingerprint) =>
    addToBoundedSet(KEYS.processedAttributions, fingerprint),
  async hasMilestone(key) {
    return (await readSet(KEYS.milestones)).has(key);
  },
  markMilestone: (key) => addToBoundedSet(KEYS.milestones, key, 500),
  async resetDemoState() {
    await AsyncStorage.multiRemove([
      KEYS.pendingAttribution,
      KEYS.frozenReferralCode,
      KEYS.processedAttributions,
      KEYS.milestones,
    ]);
  },
};
