import { describe, expect, it } from '@jest/globals';

import { createMockReferralApi } from '../src/services/referrals/mockReferralApi';

import type { ReferralEventRecord } from '../src/domain/analytics';
import type { ReferralAttribution } from '../src/domain/referral';
import type {
  ReferralAcceptanceReceipt,
  ReferralStorage,
} from '../src/services/storage/referralStorage';

const CODE_B = 'MAL-ZYXW9876';

class ApiStorage implements ReferralStorage {
  readonly generatedCodes = new Map<string, string>();
  readonly receipts = new Map<string, ReferralAcceptanceReceipt>();
  receiptWrites = 0;

  async getGeneratedCode(userId: string): Promise<string | null> {
    return this.generatedCodes.get(userId) ?? null;
  }
  async setGeneratedCode(userId: string, code: string): Promise<void> {
    this.generatedCodes.set(userId, code);
  }
  async getSignupReceipt(idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null> {
    return this.receipts.get(idempotencyKey) ?? null;
  }
  async saveSignupReceipt(
    idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<void> {
    this.receiptWrites += 1;
    this.receipts.set(idempotencyKey, receipt);
  }

  async getPendingAttribution(): Promise<ReferralAttribution | null> {
    return null;
  }
  async savePendingAttribution(_attribution: ReferralAttribution): Promise<void> {}
  async clearPendingAttribution(): Promise<void> {}
  async getFrozenReferralCode(): Promise<string | null> {
    return null;
  }
  async freezeReferralCode(_code: string): Promise<void> {}
  async clearFrozenReferralCode(): Promise<void> {}
  async hasProcessedAttribution(_fingerprint: string): Promise<boolean> {
    return false;
  }
  async markAttributionProcessed(_fingerprint: string): Promise<void> {}
  async hasMilestone(_key: string): Promise<boolean> {
    return false;
  }
  async markMilestone(_key: string): Promise<void> {}
  async getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    return [];
  }
  async savePendingAnalyticsEvent(_event: ReferralEventRecord): Promise<void> {}
  async removePendingAnalyticsEvent(_eventId: string): Promise<void> {}
  async resetDemoState(): Promise<void> {}
}

function createApi(storage: ApiStorage, randomBytes = async () => new Uint8Array(8)) {
  return createMockReferralApi(storage, {
    delay: async () => undefined,
    randomBytes,
  });
}

describe('mock referral API', () => {
  it('coalesces concurrent generation and returns a stable valid member code', async () => {
    const storage = new ApiStorage();
    let randomCalls = 0;
    const api = createApi(storage, async () => {
      randomCalls += 1;
      return new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    const [first, second] = await Promise.all([
      api.getOrCreateCode('member-1'),
      api.getOrCreateCode('member-1'),
    ]);
    expect(first).toBe('MAL-ABCDEFGH');
    expect(second).toBe(first);
    expect(randomCalls).toBe(1);
    await expect(api.getOrCreateCode('member-1')).resolves.toBe(first);
    expect(randomCalls).toBe(1);
  });

  it('rejects missing authentication and replaces corrupt local code state', async () => {
    const storage = new ApiStorage();
    storage.generatedCodes.set('member-1', 'email@example.com');
    const api = createApi(storage);

    await expect(api.getOrCreateCode('  ')).rejects.toThrow(
      'Authenticated member identity is required.',
    );
    await expect(api.getOrCreateCode('member-1')).resolves.toBe('MAL-AAAAAAAA');
    expect(storage.generatedCodes.get('member-1')).toBe('MAL-AAAAAAAA');
  });

  it('uses one idempotent acceptance receipt across concurrency and restart', async () => {
    const storage = new ApiStorage();
    const api = createApi(storage);
    const key = 'signup:abc1234';

    const [first, concurrent] = await Promise.all([
      api.acceptReferral('MAL-ABCD2345', 'new@example.com', key),
      api.acceptReferral('MAL-ABCD2345', 'new@example.com', key),
    ]);
    expect(concurrent).toEqual(first);
    expect(storage.receiptWrites).toBe(1);

    const afterRestart = createApi(storage);
    await expect(
      afterRestart.acceptReferral('MAL-ABCD2345', 'changed@example.com', key),
    ).resolves.toEqual(first);
    expect(storage.receiptWrites).toBe(1);
    await expect(
      afterRestart.acceptReferral(CODE_B, 'new@example.com', key),
    ).rejects.toThrow('conflicts with another referral');
  });

  it('keeps a rejected acceptance retryable and creates no receipt', async () => {
    const storage = new ApiStorage();
    const api = createApi(storage);
    const key = 'signup:retry123';

    await expect(
      api.acceptReferral('MAL-ABCD2345', 'review+fail@example.com', key),
    ).rejects.toThrow('rejected this signup');
    expect(storage.receipts.size).toBe(0);
    await expect(
      api.acceptReferral('MAL-ABCD2345', 'review@example.com', key),
    ).resolves.toMatchObject({ accountId: expect.stringMatching(/^acct_[a-z0-9]{7}$/) });
  });

  it('rejects invalid acceptance inputs before creating a receipt', async () => {
    const storage = new ApiStorage();
    const api = createApi(storage);

    await expect(
      api.acceptReferral('BAD-CODE', 'new@example.com', 'signup:abc1234'),
    ).rejects.toThrow('Referral code is invalid');
    await expect(
      api.acceptReferral('MAL-ABCD2345', 'new@example.com', ''),
    ).rejects.toThrow('idempotency key is invalid');
    expect(storage.receipts.size).toBe(0);
  });
});
