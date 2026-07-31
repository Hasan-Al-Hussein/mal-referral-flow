import { describe, expect, it } from '@jest/globals';

import {
  REFERRAL_DESTINATION,
  parseReferralAttribution,
  type RawDeepLinkEvent,
} from '../src/domain/referral';

const DIRECT_CODE = 'MAL-ABCD2345';
const NOW = new Date('2026-07-31T12:00:00.000Z');

function branchEvent(overrides: Partial<RawDeepLinkEvent> = {}): RawDeepLinkEvent {
  return {
    uri: 'https://mal.test-app.link/referral',
    params: {
      '+clicked_branch_link': true,
      '+is_first_session': false,
      '+click_timestamp': '1774958400',
      $deeplink_path: REFERRAL_DESTINATION,
      referral_code: DIRECT_CODE,
    },
    ...overrides,
  };
}

describe('parseReferralAttribution', () => {
  it.each([
    { firstSession: false, expectedKind: 'direct' },
    { firstSession: true, expectedKind: 'deferred' },
  ] as const)('accepts a valid $expectedKind Branch attribution', ({ firstSession, expectedKind }) => {
    const result = parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          '+is_first_session': firstSession,
          '+click_timestamp': '1774958400',
          $deeplink_path: REFERRAL_DESTINATION,
          referral_code: ' mal-abcd2345 ',
        },
      }),
      () => NOW,
    );

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error('Expected an accepted attribution');

    expect(result.attribution).toMatchObject({
      referralCode: DIRECT_CODE,
      destination: REFERRAL_DESTINATION,
      kind: expectedKind,
      uri: 'https://mal.test-app.link/referral',
      receivedAt: NOW.toISOString(),
    });
    expect(result.attribution.fingerprint).toMatch(/^[a-z0-9]{7}$/);
  });

  it('rejects a missing referral code', () => {
    const result = parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: REFERRAL_DESTINATION,
        },
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'missing_code',
      referralCode: 'UNAVAILABLE',
    });
  });

  it('rejects a malformed referral code after normalizing it', () => {
    const result = parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: REFERRAL_DESTINATION,
          referral_code: ' bad-code ',
        },
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid_code',
      referralCode: 'BAD-CODE',
    });
  });

  it('rejects a valid code aimed at an unsupported destination', () => {
    const result = parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: 'payments/transfer',
          referral_code: DIRECT_CODE,
        },
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'unsupported_destination',
      referralCode: DIRECT_CODE,
      detail: 'payments/transfer',
    });
  });

  it('ignores a session that was not opened by a Branch click', () => {
    const result = parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': false,
          referral_code: DIRECT_CODE,
        },
      }),
    );

    expect(result).toEqual({ status: 'ignored', reason: 'not_a_branch_click' });
  });
});
