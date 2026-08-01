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
  flowId =
    name === 'referral_link_generated' || name === 'referral_link_shared'
      ? `referrer:${referralCode}`
      : 'invitee:journey-a',
): ReferralLedgerEntry {
  return {
    delivery,
    event: {
      name,
      properties: {
        referral_code: referralCode,
        platform: 'web',
        event_id: `evt_${referralCode}_${name}`,
        flow_id: flowId,
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
    expect(getAcceptedReferralMilestones(entries, 'MAL-BBBBBBBB', 'journey-a').size).toBe(3);
  });

  it('counts only accepted required milestones', () => {
    const entries = [
      ledgerEntry('referral_link_generated', 'MAL-AAAAAAAA'),
      ledgerEntry('referral_link_shared', 'MAL-AAAAAAAA', 'failed'),
      ledgerEntry('referral_link_clicked', 'MAL-AAAAAAAA', 'duplicate'),
      ledgerEntry('referral_duplicate_suppressed', 'MAL-AAAAAAAA'),
    ];

    expect([...getAcceptedReferralMilestones(entries, 'MAL-AAAAAAAA', 'journey-a')]).toEqual([
      'referral_link_generated',
    ]);
  });

  it('shares referrer milestones but never combines same-code invitee journeys', () => {
    const code = 'MAL-AAAAAAAA';
    const entries = [
      ledgerEntry('referral_link_generated', code),
      ledgerEntry('referral_link_shared', code),
      ledgerEntry('referral_link_clicked', code, 'accepted', 'invitee:journey-a'),
      ledgerEntry('referral_signup_started', code, 'accepted', 'invitee:journey-a'),
      ledgerEntry('referral_signup_completed', code, 'accepted', 'invitee:journey-b'),
    ];

    expect([...getAcceptedReferralMilestones(entries, code, 'journey-a')]).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_link_clicked',
      'referral_signup_started',
    ]);
    expect([...getAcceptedReferralMilestones(entries, code, 'journey-b')]).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_signup_completed',
    ]);
    expect(scopeReferralEntries(entries, code, 'journey-a')).toHaveLength(4);
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
