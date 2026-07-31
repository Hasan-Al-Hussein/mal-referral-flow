# Referral Flow Architecture and Reliability

## Executive summary

This prototype separates the referral product flow from vendor SDKs so that the same domain logic can run in two environments:

- A reviewer-accessible web build exercises referral generation, sharing, validation, routing, deduplication, failure states, and the complete analytics contract without requiring credentials.
- Native Expo development/preview builds use Branch for direct and deferred deep links and Firebase Analytics for event delivery.

The important reliability boundary is explicit: the public web demo proves the UI and application logic, but it cannot prove operating-system Universal Links/App Links or an install-store-first-launch handoff. Those require a signed native build, configured Branch and Firebase projects, and a real Play Store internal-testing or TestFlight install path. This repository contains no real credentials and does not claim that a store-mediated deferred-link test has been completed.

## Goals and non-goals

### Goals

- Let an authenticated user obtain a stable, unique referral code and share a Branch link through the native share sheet.
- Route direct, cold-start, warm-start, and deferred link opens to referred onboarding with the code pre-applied.
- Preserve referral attribution across SDK, authentication, navigation, network, and process-lifecycle boundaries.
- Emit the five required funnel events with a non-empty `referral_code` and explicit platform context.
- Make duplicate callbacks, invalid data, cancellation, offline behavior, and SDK failure visible and testable.
- Keep reward eligibility and account creation safe to move behind an authoritative backend.

### Non-goals

- Issuing real financial rewards.
- Implementing production authentication, KYC, fraud detection, or a referral ledger backend.
- Treating client-side attribution as proof of reward eligibility.
- Claiming that browser simulations prove native or store behavior.

## Technology decisions

### Expo SDK 56 with development builds

Expo SDK 56 is used for React Native development, typed configuration, and reproducible web and native builds. Expo gives the prototype fast iteration and an accessible browser artifact while `expo prebuild`/EAS development builds still permit native Branch and React Native Firebase modules.

This is deliberately **not** an Expo Go integration. Expo Go has a fixed native binary and cannot load arbitrary native modules such as `react-native-branch` or `@react-native-firebase/analytics`. Native link verification therefore uses a custom development or preview build. The Branch Expo config plugin is community-maintained, so versions are pinned and the generated Android manifest, iOS entitlements, `assetlinks.json`, and AASA configuration must be reviewed during a production release.

### Branch instead of Firebase Dynamic Links

Branch is responsible for link creation, direct deep links, deferred deep links, and attribution metadata. Firebase Dynamic Links was shut down on August 25, 2025 and is not viable for a new implementation. Branch supplies one subscription surface for the initial cached open and later link opens, plus the metadata needed to distinguish an ordinary launch from a referred first session.

The native adapter uses the real React Native SDK shapes:

```ts
const buo = await branch.createBranchUniversalObject(`referral/${code}`, {
  title: 'Join me on Mal',
  contentDescription: 'Open a Mal account with my referral code already applied.',
  contentMetadata: { customMetadata: { referral_code: code } },
});

try {
  const { url } = await buo.generateShortUrl(
    {
      feature: 'referral',
      channel: 'in_app_share',
      campaign: 'member_referral',
    },
    {
      $deeplink_path: 'onboarding/referral',
      referral_code: code,
    },
  );
  return url;
} finally {
  buo.release();
}
```

The implementation releases the native Branch object in `finally`. Mal-controlled Branch domains, store destinations, and web fallbacks are provider-dashboard configuration supplied outside source control.

References:

- [Firebase Dynamic Links deprecation FAQ](https://firebase.google.com/support/dynamic-links-faq)
- [Branch React Native reference](https://help.branch.io/developer-hub/docs/react-native-full-reference)
- [Branch Expo integration](https://help.branch.io/developer-hub/docs/react-native-expo-integration)

### Firebase Analytics instead of MoEngage

Firebase Analytics is used behind a typed adapter because it provides a small event API, native offline batching, DebugView for verification, and a clear path to BigQuery analysis. The native adapter calls the current modular React Native Firebase signature:

```ts
await logEvent(getAnalytics(), eventName, parameters);
```

The web reviewer adapter validates the same event schema and writes events to an inspectable local ledger. It does not pretend to send native Firebase events. On native, Firebase configuration files are supplied locally or through CI and are never committed with secrets.

Reference: [React Native Firebase Analytics](https://rnfirebase.io/analytics/usage)

## Component model

| Layer | Responsibility | Important constraint |
| --- | --- | --- |
| Screens/components | Render generation, sharing, onboarding, recovery, and reviewer states | No vendor SDK calls |
| Referral domain | Validate codes and attribution, define events, model flow transitions | Pure and unit-testable |
| Referral coordinator | Sequence capture, persistence, deduplication, analytics, auth, and navigation | One coordinator per app process |
| Referral API | Return a stable code and accept an idempotent signup attempt | Local mock now; backend contract later |
| Link service | Create Branch links and subscribe to link opens | Native and reviewer implementations |
| Analytics service | Validate and emit typed events | Firebase native; visible local ledger on web |
| Attribution storage | Persist pending referral, processed-link keys, and milestone receipts | Stored data is untrusted input |
| Share service | Invoke `Share.share` or browser Web Share/copy fallback | Platform outcome semantics differ |

Dependency inversion keeps the coordinator unaware of Branch, Firebase, React Navigation, or browser APIs. Vendor-specific code is isolated in platform adapters, while tests inject deterministic fakes.

## Referral lifecycle

The lifecycle below is the design model. The prototype exposes these states through explicit screen status fields and the coordinator's persisted attribution milestones:

```text
idle
  -> generating_code
  -> generating_link
  -> ready_to_share
  -> sharing
  -> shared | share_cancelled | recoverable_error

link_received
  -> validating
  -> captured
  -> waiting_for_auth_and_navigation
  -> signup_started
  -> signup_completed | rejected | recoverable_error
```

### Referrer flow

1. The authenticated referral screen calls `getOrCreateReferralCode(userId)`.
2. The prototype mock returns the same persisted code for the same mock user. A production endpoint must generate a high-entropy opaque code and enforce uniqueness server-side.
3. The link service creates a Branch Universal Object and short link containing only an allowlisted route and the code.
4. `referral_link_generated` is emitted only after a usable URL is returned.
5. The user explicitly taps Share; the service opens the native share sheet.
6. `referral_link_shared` is emitted only when the platform reports a successful handoff. Cancellation and thrown errors have separate failure events.

Android does not reliably prove that a recipient received the content after the chooser opens. Accordingly, `referral_link_shared` means "the operating system accepted the share request"; it is not a delivery receipt.

### Link creation failure

If code generation or Branch URL creation fails, the UI shows a retryable error and does not emit a success event. The app does not fabricate a link that looks production-ready. Persisting and reusing a provider-issued URL offline is a possible production extension, not behavior claimed by this prototype.

## Direct and deferred deep links

### One ingestion path

The native app registers one Branch subscription at bootstrap, before screen effects can run:

```ts
branch.subscribe({
  onOpenComplete: ({ error, params, uri }) => {
    // Forward to the coordinator; never navigate directly here.
  },
});
```

Branch recommends `subscribe()` for both the cached initial event and subsequent opens. Calling `getLatestReferringParams()` independently at launch can race the listener and produce duplicate handling.

The coordinator accepts only callbacks where `+clicked_branch_link === true`, then extracts and validates:

- `referral_code`
- `+is_first_session`
- `+click_timestamp`
- `$deeplink_path`
- the callback URI, when supplied

The route is fixed by application policy. Link data cannot request arbitrary screens or redirect URLs.

### Lifecycle matrix

| Case | SDK behavior | Coordinator behavior |
| --- | --- | --- |
| Installed, app foregrounded/backgrounded | Subscription receives a new open | Validate, dedupe, persist, then route when safe |
| Installed, process terminated | Cached initial callback may arrive before React Navigation is ready | Persist immediately and wait for navigation/auth readiness |
| Not installed, first launch after install | Branch returns referring data with `+is_first_session` | Mark `is_deferred`, then use the same validation and routing path |
| Ordinary app launch | No clicked Branch link | Do nothing; do not reuse stale latest parameters |
| SDK error or late response | Callback contains error or arrives after normal startup | Keep normal startup usable, record failure, and handle a legitimate late link when safe |

### Durable auth handoff

Navigation and authentication hydrate asynchronously. A valid referral is therefore persisted before either dependency is consulted. Once both are ready:

- An unauthenticated recipient is routed to referred onboarding with a visible, pre-applied code.
- In production, an already authenticated account should be shown an ineligibility message instead of receiving retroactive attribution. The assessment fixture focuses on the new-user path.
- Before signup begins, a newer explicit valid click may replace the pending code.
- Once signup begins, the chosen code is frozen to prevent attribution hijacking.
- Completion or definitive rejection clears the pending record.

The code is stored locally for continuity, not trust. A production server still checks existence, status, expiry, campaign eligibility, and self-referral.

### Deferred-link accuracy

`+is_first_session` identifies the first referred session, but it is not authorization to issue a reward. On privacy-restricted platforms, Branch may report `+match_guaranteed === false`. The app may still present the referral for confirmation, but only a backend may accept it. A manual code-entry recovery path is appropriate for production when attribution cannot be recovered.

## Analytics contract

All required success events pass through one typed function. Every payload contains an actual non-empty referral code and platform context:

```ts
type ReferralAnalyticsContext = {
  referral_code: string;
  platform: 'ios' | 'android' | 'web' | 'windows' | 'macos' | 'unknown';
  event_id: string;
  flow_id: string;
  schema_version: 1;
  app_version: string;
  occurred_at_utc: string;
  attribution_kind?: 'direct' | 'deferred' | 'demo-direct' | 'demo-deferred';
  is_first_session?: boolean;
};
```

`web` is used only by the reviewer build and is never presented as a native platform result.

### Required success events

| Event | Emission point | Additional useful fields |
| --- | --- | --- |
| `referral_link_generated` | Branch/reviewer link creation resolves with a usable URL | `link_id`, `generation_source` |
| `referral_link_shared` | Native/browser share handoff resolves successfully | `share_result`, `activity_type` when available |
| `referral_link_clicked` | A valid, non-duplicate attribution callback is accepted | `link_id`, `click_timestamp`, `match_guaranteed` |
| `referral_signup_started` | Referred onboarding becomes active and the code is frozen | `entry_mode`, `signup_attempt_id` |
| `referral_signup_completed` | Account creation succeeds and the referral is accepted | `signup_attempt_id`, `acceptance_result` |

`referral_signup_completed` is not fired for an invalid or rejected referral merely because ordinary signup later succeeds.

### Failure and diagnostic events

Failure events make silent production gaps observable:

- `referral_link_generation_failed`
- `referral_link_share_cancelled`
- `referral_link_share_failed`
- `referral_deeplink_resolution_failed`
- `referral_code_rejected`
- `referral_signup_failed`
- `referral_duplicate_suppressed`

They include a bounded non-sensitive `reason` and the referral code when one is known. Failures before code creation use the explicit `UNAVAILABLE` sentinel; no user identifier or fabricated valid-looking code is logged.

## Idempotency and delivery semantics

### Link callback deduplication

Branch callbacks can repeat after remounts, React development behavior, warm opens, or SDK retries. A durable fingerprint is derived from the strongest available fields:

```text
hash(referral_code | +click_timestamp | callback_uri | attribution_kind)
```

The coordinator stores processed fingerprints. A repeated callback may emit `referral_duplicate_suppressed` for diagnostics but cannot navigate or advance milestones again. A genuine later click normally has a different click timestamp and remains eligible.

### Funnel milestone deduplication

Each accepted invitee journey has a stable `flow_id` derived from the attribution fingerprint. A persisted milestone ledger prevents screen remounts from re-emitting `clicked`, `started`, or `completed`. Separate share button taps receive distinct flow and event IDs because they are distinct user actions.

### Exactly-once boundaries

Exactly-once analytics cannot be guaranteed between a mobile process and Firebase Analytics. `logEvent()` accepts data into a native queue but does not acknowledge final warehouse ingestion. The prototype therefore provides:

- deduplicated application invocation after a milestone is accepted locally;
- stable `event_id` values for downstream deduplication;
- Firebase's native offline batching and retries;
- retryability when the analytics adapter rejects before a milestone is marked, using the same stable event ID.

If exact reporting matters, export to BigQuery and deduplicate by `event_id`, or send business-critical events through an idempotent server collector. Referral acceptance and reward issuance must be exactly-once at the business layer using a server idempotency key, a transaction, and uniqueness constraints. Analytics is never the source of truth for money.

## Reliability behavior

- **Offline before generation:** show a retryable error; do not claim a link was generated.
- **Offline after link generation:** the in-memory URL remains shareable for the current session and Firebase owns native event batching.
- **Offline during production signup:** the backend integration must preserve pending attribution and reuse a stable server idempotency key; the local assessment endpoint is intentionally network-free.
- **Process death after link capture:** pending attribution survives and resumes after auth/navigation hydration.
- **Navigation not ready:** queue a typed navigation intent rather than calling a navigation ref prematurely.
- **Analytics unavailable:** never block sharing or signup; keep attribution retryable and do not mark an unaccepted analytics milestone.
- **Storage unavailable:** treat durable attribution as degraded and surface a recoverable error; an in-memory fallback is a production follow-up, not implemented here.
- **Multiple links:** accept the newest valid explicit click only before signup starts; freeze afterwards.
- **Stale codes:** production expiry is determined by server UTC, not the device clock.

## Security and privacy

- Treat every deep-link parameter and local-storage value as attacker-controlled.
- Enforce a strict code character set and maximum length before rendering, logging, or routing.
- Use fixed route mappings; never execute or navigate to a route supplied directly by a link.
- Production codes must be opaque and high entropy; they must not encode a name, email, phone number, or database ID.
- Do not embed Branch secrets, service-account credentials, or backend signing keys in the app. Environment configuration is not authorization.
- Validate active/expired status, campaign rules, recipient eligibility, and self-referral on the server.
- Use an idempotency key and database uniqueness constraints so retries cannot create multiple rewards.
- Do not log auth tokens, contact information, form data, or raw error stacks to analytics.
- A referral code is pseudonymous data. Limit retention and dashboard access, and apply consent requirements before enabling analytics/attribution collection.
- Advertising identifiers and tracking permissions should not be requested unless Mal's attribution purpose and consent policy require them.

## Prioritized failure matrix

| Priority | Failure mode | User/business impact | Detection | Mitigation and proof |
| --- | --- | --- | --- | --- |
| P0 | Expo Go or an unsigned web build is presented as native deferred linking | Core requirement appears to work but is false | Build/runtime capability check | Use EAS/native build; label the web simulator; perform a store-mediated test before production |
| P0 | Initial Branch callback arrives before auth/navigation readiness | Correct link opens the wrong screen or is lost | Captured-without-routed counter; cold-start test | Persist first, then gate routing on both readiness signals |
| P0 | Callback is processed twice | Duplicate navigation and inflated funnel | Duplicate fingerprint metric | Singleton subscription, durable fingerprint, milestone ledger |
| P0 | Tampered, expired, or self-referral is trusted by the client | Fraud or incorrect reward | Backend rejection and anomaly metrics | Opaque code, authoritative validation, transactional reward rules |
| P0 | Signup retry creates duplicate account/reward | Financial and customer-support impact | Idempotency-conflict metric | Stable attempt key plus unique database constraints |
| P0 | Completion is emitted before referral acceptance | Funnel overstates successful referrals | Analytics/backend reconciliation | Emit only after account and referral acceptance succeed |
| P1 | Deferred attribution returns an uncertain iOS match | Wrong or missing referral | `match_guaranteed` and platform conversion split | Confirmation/manual code fallback; never reward from SDK metadata alone |
| P1 | Branch times out or returns malformed parameters | User remains on generic launch | Resolution failure rate | Normal-start timeout, strict parser, retry/manual recovery |
| P1 | Share is cancelled but counted as shared | Inflated upper funnel | Share outcome comparison | Separate success, cancellation, and error events; document Android limitation |
| P1 | Offline state interrupts generation or signup | Abandoned funnel | Offline/failure events | Explicit retry states, cached link, durable pending code and attempt ID |
| P1 | A second click replaces an active signup code | Attribution hijack or confusion | Code-change audit | Latest-before-start, immutable-after-start policy |
| P1 | App/Universal Link verification regresses | Link opens a browser instead of the app | Device smoke test and link validator | Validate intent filters, associated domains, AASA, and `assetlinks.json` per release |
| P2 | Event schema drifts between call sites | Missing properties and broken dashboards | Contract tests | One typed analytics adapter and schema version |
| P2 | Stale pending attribution survives indefinitely | Wrong campaign attribution | Pending-age metric | Local TTL plus server-authoritative expiry |
| P2 | Sensitive data reaches logs or analytics | Privacy/compliance exposure | Automated/manual payload audit | Allowlisted fields, bounded reasons, redaction and retention policy |

## Testing strategy

### Automated tests included

- **Domain tests:** code format, attribution parsing, Branch flag interpretation, invalid and oversized inputs.
- **Coordinator tests:** persistence-before-routing, direct/deferred intake, duplicate replay, multiple links, frozen attribution, completion clearing, and analytics retryability.
- **Analytics contract tests:** all five required events contain `referral_code`, `platform`, `event_id`, `flow_id`, and `schema_version`.
- **Progress-integrity tests:** milestones from different referral codes, failed deliveries, duplicates, and diagnostic events cannot combine into a false 5/5 journey.
- **Adapter tests:** Branch/Firebase fakes assert real method shapes without requiring network credentials.

Loading, sharing, invalid-link, onboarding, and completed UI states were also exercised manually in the reviewer build. The deferred full-flow regression passed at `3/5` on onboarding and `5/5` after completion. Restart was verified to reset persisted data, analytics, navigation, and Invite-local state together, returning a remounted route at `0/5` with no stale referral code. Responsive checks covered 375 x 812, 812 x 375, and 1440 x 1000 layouts in light and dark themes. Browser reduced-motion emulation verified immediate content visibility, static state indicators, and disabled route animation. Automated component/accessibility coverage remains a production follow-up.

The repository verification gate is:

```bash
npm run check
npm run build:web
```

### Reviewer web validation

The reviewer lab should demonstrate direct and deferred inputs through the same parser/coordinator used by native adapters, show the resulting onboarding route, and expose the local event ledger. Replaying the same attribution should visibly prove that only one click/start milestone is accepted.

This validates deterministic application behavior, not operating-system link association or install attribution.

### Native validation matrix

Before production, run all cases on physical iOS and Android devices:

1. App installed and foregrounded.
2. App installed and backgrounded.
3. App installed but process terminated.
4. App absent: tap link, install through Play internal testing/TestFlight, first launch.
5. Offline on first launch, then reconnect.
6. Link opened from browser, messaging app, email, and QR scanner.
7. Invalid, expired, self-referral, and already-authenticated recipient.
8. Duplicate callback and repeated link taps.

Use Branch Link Validator and dashboard diagnostics, Firebase DebugView, Android `adb` link invocation, and iOS Universal Link diagnostics. No successful result from this matrix is claimed in this repository unless its evidence is added explicitly.

## Rollout and observability

Ship behind a remote feature flag with independent switches for link generation, referred onboarding, and reward acceptance. Use separate Branch test/live environments and Firebase development/production projects. A sensible rollout is staff-only, then 1%, 10%, 50%, and 100%, advancing only while error and conversion guardrails remain stable.

Monitor by platform, app version, and direct/deferred mode:

- Branch callback error rate.
- Clicked links missing or failing referral-code validation.
- Deferred resolution success rate and `match_guaranteed` distribution.
- Capture-to-route latency p50/p95.
- Duplicate-suppression rate.
- `generated -> shared -> clicked -> started -> completed` conversion.
- Signup/reward idempotency conflicts.
- Analytics completion count reconciled with backend-accepted referrals.
- Crash-free sessions on referral and onboarding screens.

Alert on sharp increases in missing codes, callback failures, invalid-code rate, route latency, or a platform-specific funnel drop. A kill switch must disable referral generation and reward acceptance without blocking ordinary onboarding.

## Tradeoffs and known limitations

- **Web reach versus native proof:** the anonymous web build is easy to review but cannot exercise Branch's native install attribution. The native adapter and test plan close that gap; the demo does not conceal it.
- **Expo speed versus plugin ownership:** Expo reduces delivery time, while the Branch config plugin adds supply-chain/configuration risk because Branch does not maintain it. Pinning versions and inspecting generated native output are mandatory.
- **Local mock versus authoritative backend:** the mock demonstrates stable generation and idempotent flow transitions but cannot prove global code uniqueness, expiry, anti-fraud policy, or transactional rewards.
- **Firebase simplicity versus exact delivery:** Firebase provides excellent mobile instrumentation and offline delivery, but it cannot give end-to-end exactly-once guarantees. Stable IDs and downstream/backend reconciliation are required.
- **Platform share APIs:** a successful share-sheet result is not a recipient delivery receipt, especially on Android.
- **Privacy-restricted attribution:** deferred matching may be uncertain. Product UX must allow recovery, and business decisions must remain server-authoritative.

## Production follow-ups

1. Add a referral backend with `get-or-create`, validation, signup acceptance, expiry, anti-abuse rules, and an idempotent reward ledger.
2. Configure Mal-owned Branch domains, Android App Links, iOS Universal Links, store destinations, and safe web fallbacks.
3. Configure consent-aware Firebase projects, DebugView verification, BigQuery export, retention, and access controls.
4. Run and record the full native/store matrix on supported OS versions.
5. Add remote-config rollout controls, operational dashboards, and on-call alerts.
6. Perform security, privacy, accessibility, and fraud reviews before any monetary incentive is enabled.
