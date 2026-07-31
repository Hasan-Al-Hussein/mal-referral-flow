import {
  REQUIRED_REFERRAL_EVENTS,
  type ReferralEventRecord,
  type RequiredReferralEventName,
} from '../domain/analytics';

import type { AnalyticsDelivery } from '../services/analytics/AnalyticsTracker';

export interface ReferralLedgerEntry {
  event: ReferralEventRecord;
  delivery: AnalyticsDelivery;
}

const requiredMilestones = new Set<string>(REQUIRED_REFERRAL_EVENTS);

export function scopeReferralEntries<T extends ReferralLedgerEntry>(
  entries: readonly T[],
  referralCode?: string | null,
): T[] {
  const scopedCode = referralCode ?? entries[0]?.event.properties.referral_code;
  if (!scopedCode) return [];
  return entries.filter(({ event }) => event.properties.referral_code === scopedCode);
}

export function getAcceptedReferralMilestones(
  entries: readonly ReferralLedgerEntry[],
  referralCode: string,
): Set<RequiredReferralEventName> {
  const accepted = new Set<RequiredReferralEventName>();
  for (const { event, delivery } of entries) {
    if (
      delivery === 'accepted' &&
      event.properties.referral_code === referralCode &&
      requiredMilestones.has(event.name)
    ) {
      accepted.add(event.name as RequiredReferralEventName);
    }
  }
  return accepted;
}
