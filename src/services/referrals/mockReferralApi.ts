import * as Crypto from 'expo-crypto';

import { isValidReferralCode, stableHash } from '../../domain/referral';

import type { ReferralStorage } from '../storage/referralStorage';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_USER_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 160;

export interface MockReferralApi {
  getOrCreateCode(userId: string): Promise<string>;
  acceptReferral(
    code: string,
    email: string,
    idempotencyKey: string,
  ): Promise<{ accountId: string }>;
}

interface MockReferralApiOptions {
  delay?: (milliseconds: number) => Promise<void>;
  randomBytes?: (length: number) => Promise<Uint8Array>;
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function encodeCode(bytes: Uint8Array): string {
  return `MAL-${[...bytes]
    .slice(0, 8)
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('')}`;
}

export function createMockReferralApi(
  storage: ReferralStorage,
  options: MockReferralApiOptions = {},
): MockReferralApi {
  const wait = options.delay ?? defaultDelay;
  const randomBytes = options.randomBytes ?? Crypto.getRandomBytesAsync;
  const pendingCodeRequests = new Map<string, Promise<string>>();
  const pendingAcceptances = new Map<
    string,
    { referralCode: string; promise: Promise<{ accountId: string }> }
  >();

  return {
    getOrCreateCode(userId) {
      const normalizedUserId = userId.trim();
      if (!normalizedUserId || normalizedUserId.length > MAX_USER_ID_LENGTH) {
        return Promise.reject(new Error('Authenticated member identity is required.'));
      }

      const existingRequest = pendingCodeRequests.get(normalizedUserId);
      if (existingRequest) return existingRequest;

      const request = (async () => {
        await wait(420);
        const existing = await storage.getGeneratedCode(normalizedUserId);
        if (isValidReferralCode(existing)) return existing.trim().toUpperCase();

        const bytes = await randomBytes(8);
        const code = encodeCode(bytes);
        if (!isValidReferralCode(code)) throw new Error('Referral code generation failed.');
        await storage.setGeneratedCode(normalizedUserId, code);
        return code;
      })();
      pendingCodeRequests.set(normalizedUserId, request);
      const clearRequest = () => {
        if (pendingCodeRequests.get(normalizedUserId) === request) {
          pendingCodeRequests.delete(normalizedUserId);
        }
      };
      void request.then(clearRequest, clearRequest);
      return request;
    },

    async acceptReferral(code, email, idempotencyKey) {
      if (!isValidReferralCode(code)) throw new Error('Referral code is invalid.');
      if (
        !idempotencyKey ||
        idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
      ) {
        throw new Error('Signup idempotency key is invalid.');
      }

      const receipt = await storage.getSignupReceipt(idempotencyKey);
      if (receipt) {
        if (receipt.referralCode !== code) {
          throw new Error('Signup idempotency key conflicts with another referral.');
        }
        return { accountId: receipt.accountId };
      }

      const pending = pendingAcceptances.get(idempotencyKey);
      if (pending) {
        if (pending.referralCode !== code) {
          throw new Error('Signup idempotency key conflicts with another referral.');
        }
        return pending.promise;
      }

      const promise = (async () => {
        await wait(700);
        if (email.toLowerCase().includes('+fail')) {
          throw new Error('The demo endpoint rejected this signup.');
        }

        const repeatedReceipt = await storage.getSignupReceipt(idempotencyKey);
        if (repeatedReceipt) {
          if (repeatedReceipt.referralCode !== code) {
            throw new Error('Signup idempotency key conflicts with another referral.');
          }
          return { accountId: repeatedReceipt.accountId };
        }

        const accountId = `acct_${stableHash(`signup:${idempotencyKey}:${code}`)}`;
        await storage.saveSignupReceipt(idempotencyKey, {
          accountId,
          referralCode: code.trim().toUpperCase(),
        });
        return { accountId };
      })();
      pendingAcceptances.set(idempotencyKey, { referralCode: code, promise });
      const clearAcceptance = () => {
        if (pendingAcceptances.get(idempotencyKey)?.promise === promise) {
          pendingAcceptances.delete(idempotencyKey);
        }
      };
      void promise.then(clearAcceptance, clearAcceptance);
      return promise;
    },
  };
}
