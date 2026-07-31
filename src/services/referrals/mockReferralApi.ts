import * as Crypto from 'expo-crypto';

import type { ReferralStorage } from '../storage/referralStorage';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface MockReferralApi {
  getOrCreateCode(userId: string): Promise<string>;
  acceptReferral(code: string, email: string): Promise<{ accountId: string }>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function encodeCode(bytes: Uint8Array): string {
  return `MAL-${[...bytes]
    .slice(0, 8)
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('')}`;
}

export function createMockReferralApi(storage: ReferralStorage): MockReferralApi {
  return {
    async getOrCreateCode(userId) {
      await delay(420);
      const existing = await storage.getGeneratedCode(userId);
      if (existing) return existing;

      const bytes = await Crypto.getRandomBytesAsync(8);
      const code = encodeCode(bytes);
      await storage.setGeneratedCode(userId, code);
      return code;
    },
    async acceptReferral(code, email) {
      await delay(700);
      if (email.toLowerCase().includes('+fail')) {
        throw new Error('The demo endpoint rejected this signup.');
      }
      return { accountId: `acct_${code.slice(-4).toLowerCase()}_${Date.now().toString(36)}` };
    },
  };
}
