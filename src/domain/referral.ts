export const REFERRAL_CODE_PATTERN = /^MAL-[A-HJ-NP-Z2-9]{8}$/;
export const REFERRAL_DESTINATION = 'onboarding/referral';

export type AttributionKind = 'direct' | 'deferred' | 'demo-direct' | 'demo-deferred';

export interface RawDeepLinkEvent {
  params?: Record<string, unknown>;
  uri?: string;
  error?: string;
}

export interface ReferralAttribution {
  referralCode: string;
  destination: typeof REFERRAL_DESTINATION;
  kind: AttributionKind;
  fingerprint: string;
  uri?: string;
  receivedAt: string;
}

export type AttributionParseResult =
  | { status: 'accepted'; attribution: ReferralAttribution }
  | { status: 'ignored'; reason: 'not_a_branch_click' }
  | {
      status: 'rejected';
      reason: 'provider_error' | 'missing_code' | 'invalid_code' | 'unsupported_destination';
      referralCode: string;
      detail?: string;
    };

export function normalizeReferralCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isValidReferralCode(value: unknown): value is string {
  return REFERRAL_CODE_PATTERN.test(normalizeReferralCode(value));
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function parseReferralAttribution(
  event: RawDeepLinkEvent,
  now: () => Date = () => new Date(),
): AttributionParseResult {
  const params = event.params ?? {};
  const rawCode = params.referral_code ?? params.referralCode;
  const referralCode = normalizeReferralCode(rawCode) || 'UNAVAILABLE';

  if (event.error) {
    return {
      status: 'rejected',
      reason: 'provider_error',
      referralCode,
      detail: event.error,
    };
  }

  const isDemo = asBoolean(params.__demo);
  if (!asBoolean(params['+clicked_branch_link']) && !isDemo) {
    return { status: 'ignored', reason: 'not_a_branch_click' };
  }

  if (!rawCode) {
    return { status: 'rejected', reason: 'missing_code', referralCode };
  }

  if (!isValidReferralCode(rawCode)) {
    return { status: 'rejected', reason: 'invalid_code', referralCode };
  }

  const destination = asString(params.$deeplink_path) ?? REFERRAL_DESTINATION;
  if (destination !== REFERRAL_DESTINATION) {
    return {
      status: 'rejected',
      reason: 'unsupported_destination',
      referralCode,
      detail: destination,
    };
  }

  const isDeferred = asBoolean(params['+is_first_session']);
  const kind: AttributionKind = isDemo
    ? isDeferred
      ? 'demo-deferred'
      : 'demo-direct'
    : isDeferred
      ? 'deferred'
      : 'direct';
  const normalizedCode = normalizeReferralCode(rawCode);
  const fingerprintInput = [
    normalizedCode,
    asString(params['+click_timestamp']) ?? 'no-timestamp',
    event.uri ?? 'no-uri',
    kind,
  ].join('|');

  return {
    status: 'accepted',
    attribution: {
      referralCode: normalizedCode,
      destination: REFERRAL_DESTINATION,
      kind,
      fingerprint: stableHash(fingerprintInput),
      ...(event.uri ? { uri: event.uri } : {}),
      receivedAt: now().toISOString(),
    },
  };
}
