import type { AttributionKind } from './referral';

export const REQUIRED_REFERRAL_EVENTS = [
  'referral_link_generated',
  'referral_link_shared',
  'referral_link_clicked',
  'referral_signup_started',
  'referral_signup_completed',
] as const;

export const ANALYTICS_SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

export const FAILURE_REFERRAL_EVENTS = [
  'referral_link_generation_failed',
  'referral_link_share_cancelled',
  'referral_link_share_failed',
  'referral_deeplink_resolution_failed',
  'referral_code_rejected',
  'referral_signup_failed',
  'referral_duplicate_suppressed',
] as const;

export type RequiredReferralEventName = (typeof REQUIRED_REFERRAL_EVENTS)[number];
export type FailureReferralEventName = (typeof FAILURE_REFERRAL_EVENTS)[number];
export type ReferralEventName = RequiredReferralEventName | FailureReferralEventName;
export type PlatformName = 'android' | 'ios' | 'web' | 'windows' | 'macos' | 'unknown';

export interface ReferralEventProperties {
  referral_code: string;
  platform: PlatformName;
  event_id: string;
  flow_id: string;
  occurred_at_utc: string;
  schema_version: number;
  app_version: string;
  attribution_kind?: AttributionKind;
  reason?: string;
  share_channel?: string;
  is_first_session?: boolean;
}

export interface ReferralEventRecord {
  name: ReferralEventName;
  properties: ReferralEventProperties;
}

export interface AnalyticsClient {
  logEvent(event: ReferralEventRecord): Promise<void>;
}
