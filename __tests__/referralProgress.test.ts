import { describe, expect, it } from '@jest/globals';

import {
  getAcceptedReferralMilestones,
  scopeReferralEntries,
  type ReferralLedgerEntry,
} from '../src/application/referralProgress';

import type { ReferralEventName } from '../src/domain/analytics';
import type { AnalyticsDelivery } from '../src/services/analytics/AnalyticsTracker';

function ledgerEntry(
  name: ReferralEventName,
  referralCode: string,
  delivery: AnalyticsDelivery = 'accepted',
): ReferralLedgerEntry {
  return {
    delivery,
    event: {
      name,
      properties: {
        referral_code: referralCode,
        platform: 'web',
        event_id: `evt_${referralCode}_${name}`,
        flow_id: `flow_${referralCode}`,
        occurred_at_utc: '2026-07-31T00:00:00.000Z',
        schema_version: 1,
        app_version: '1.0.0',
      },
    },
  };
}

describe('referral progress', () => {
  it('never combines milestones from different referral codes', () => {
    const entries = [
      ledgerEntry('referral_link_generated', 'MAL-AAAAAAAA'),
      ledgerEntry('referral_link_shared', 'MAL-AAAAAAAA'),
      ledgerEntry('referral_link_clicked', 'MAL-BBBBBBBB'),
      ledgerEntry('referral_signup_started', 'MAL-BBBBBBBB'),
      ledgerEntry('referral_signup_completed', 'MAL-BBBBBBBB'),
    ];

    expect(getAcceptedReferralMilestones(entries, 'MAL-AAAAAAAA').size).toBe(2);
    expect(getAcceptedReferralMilestones(entries, 'MAL-BBBBBBBB').size).toBe(3);
  });

  it('counts only accepted required milestones', () => {
    const entries = [
      ledgerEntry('referral_link_generated', 'MAL-AAAAAAAA'),
      ledgerEntry('referral_link_shared', 'MAL-AAAAAAAA', 'failed'),
      ledgerEntry('referral_link_clicked', 'MAL-AAAAAAAA', 'duplicate'),
      ledgerEntry('referral_duplicate_suppressed', 'MAL-AAAAAAAA'),
    ];

    expect([...getAcceptedReferralMilestones(entries, 'MAL-AAAAAAAA')]).toEqual([
      'referral_link_generated',
    ]);
  });

  it('scopes visible entries explicitly or to the latest referral code', () => {
    const entries = [
      ledgerEntry('referral_link_clicked', 'MAL-BBBBBBBB'),
      ledgerEntry('referral_link_generated', 'MAL-AAAAAAAA'),
    ];

    expect(scopeReferralEntries(entries).map(({ event }) => event.properties.referral_code)).toEqual([
      'MAL-BBBBBBBB',
    ]);
    expect(
      scopeReferralEntries(entries, 'MAL-AAAAAAAA').map(
        ({ event }) => event.properties.referral_code,
      ),
    ).toEqual(['MAL-AAAAAAAA']);
  });
});
