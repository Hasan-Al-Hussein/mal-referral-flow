# Backend and reliability audit evidence

This follow-up audits baseline `651293d711668300414ae7e228c28d29646a5096` and the first reliability commit `7239fd2ea98ff078e65bd9056791e60c9655ef27`. “Deterministic repository proof” means source, test, config-evaluation, or export evidence that can run without provider credentials. It does not mean native compilation, plugin-mod inspection, signing, provider delivery, physical-device behavior, or store-mediated attribution.

## Independent review blockers

| ID | Blocker | Resolution | Deterministic proof | Status |
| --- | --- | --- | --- | --- |
| 1 | Backend acceptance and completion analytics could succeed, then split cleanup failure reported signup failure | Pending and frozen data are one journey record. Backend acceptance is the commit point; completion analytics and atomic cleanup follow it. Cleanup failure is retained, reported as `referral_state_cleanup_failed`, and retried from the idempotent receipt without `referral_signup_failed`. | Coordinator acceptance/cleanup-failure/restart-retry test; storage one-record cleanup failure test | Repository proof |
| 2 | Expired pending attribution could leave an immortal frozen code | Frozen state now stores the complete attribution (`referralCode`, fingerprint, `receivedAt`, kind) and uses the same schema/30-day validation as pending state. Invalid or expired fields are removed inside the journey lock. | Storage stale pending+frozen cleanup and subsequent fresh-freeze test; domain TTL tests | Repository proof |
| 3 | Same-code/different-fingerprint attribution could substitute journey identity | Signup start freezes the persisted pending identity. Completion flow ID, telemetry context, and idempotency key are derived from that frozen identity; a supplied different fingerprint is rejected before API acceptance. | Coordinator same-code attribution-substitution regression | Repository proof |
| 4 | Reset was not a lifecycle barrier | Reset synchronously cancels coordinator, analytics, and mock-API lifecycles; replaces blocked queues; clears route/request state; and rotates the storage epoch before awaiting cleanup. Old writes remain in an inactive namespace. | Delayed pending write/route, generation, share, backend acceptance, startup flush, and hung-reset tests; exact reset→fresh flow regression | Repository proof in one JS runtime |
| 5 | Mock idempotency was not canonical or atomic across API instances | Code is normalized once before validation, comparison, hashing, and persistence. Storage exposes serialized atomic create-if-absent receipt semantics shared by API instances and rejects a different canonical code. | Case/whitespace retry; two-instance same-code race; two-instance conflict; storage atomic receipt tests | Repository proof for mock storage; production DB transaction external |
| 6 | Native config required both Firebase files and described an unworkable EAS secret path | Config selects Android JSON or iOS plist only. Profiles specify EAS environments and local platform hints. Local config uses ignored conventional filenames; the worker requires the matching uploaded file variable. | Web, missing-Branch, Android-only, iOS-only, all-platform failure, invalid-platform, and selected-file `expo config --type public` probes | Config-evaluation proof only |
| 7 | Deterministic 32-bit event IDs collided and diagnostics repeated after restart | Events use random 128-bit UUID material. Outbox reservation persists one ID per milestone and returns it on retry; diagnostics always allocate a new ID. | Concrete `13auvky`/`19hyv32` collision regression; restart diagnostic-ID test; stable outbox retry test | Repository proof; final Firebase dedupe external |
| 8 | Invalid read/validate/delete could erase a concurrent valid write | Journey reads, validation, invalid cleanup, writes, freeze, and completion cleanup share one per-epoch/per-key critical section. | Controlled invalid-read versus valid-write race | Repository proof in one JS runtime |
| 9 | Never-settling dependencies could wedge queues and reset forever | Coordinator, analytics, and mock API boundaries have bounded timeouts. Lifecycle reset replaces queues and rotates storage epoch without waiting for an old hung operation. | Fake-timer hung analytics/API/reset tests plus subsequent-operation recovery | Repository proof; OS-native SDK cancellation behavior external |
| 10 | Evidence overstated native/config/deferred proof | README and architecture distinguish deterministic application/config evidence from Prebuild, compiled native, device, provider, and store proof. Web deferred inputs remain `demo-deferred`. | Claim-to-code review; web export; native adapter call-shape tests | Truthfulness proved; native evidence external |
| P1 | Cold restart restored a route but visible progress could reset to 0/5 or 2/5 | Accepted required-event records are persisted and hydrated for presentation without analytics delivery. Snapshot filtering uses referral code plus the exact invitee fingerprint. | Cold-restart 3/5 snapshot test; same-code/different-fingerprint isolation; no extra client calls | Repository proof |

## Assessment contract matrix

| Requirement | Evidence | Proof level |
| --- | --- | --- |
| Expo React Native choice justified | Pinned Expo/React Native dependencies, custom-development-build rationale, Expo Doctor, web export | Repository/config proof; native compile external |
| Authenticated referrer generates unique shareable link and invokes native share | Auth-required generation, stable per-epoch mock code, HTTPS validation, Branch payload adapter, `Share.share` outcome adapter | Fixture/call-shape proof; global uniqueness and device sheet external |
| Direct incoming link routes with pre-applied code | Strict Branch-shaped parser, persist-before-route coordinator, warm/cold route tests | Application proof; App/Universal Link association external |
| Deferred link survives install and first launch | Same accepted callback path, first-session metadata, pending persistence, cold restore, `demo-deferred` web fixture | Post-callback application proof only; store handoff external |
| Branch rather than Firebase Dynamic Links | Branch native adapter and plugin config; architecture records Dynamic Links shutdown rationale | Source/config proof; provider project external |
| Exact five events with code and platform | Typed allowlist, schema validator, full-funnel test, accepted presentation snapshot | Repository proof through adapter acceptance |
| Firebase Analytics real signature | Native adapter calls `logEvent(getAnalytics(), name, properties)` | Mocked call-shape proof; DebugView/warehouse external |
| Mock backend acceptable and failure paths covered | Stable get-or-create, explicit `+fail`, canonical atomic receipt, retries/conflicts/concurrency | Repository proof for mock |
| Reliability document weighted equally | Architecture covers silent failures, timeouts, retries, duplicate callbacks, idempotency, ordering, privacy, observability, platform behavior, rollout/rollback, and limitations | Document/code reconciliation |
| Web demo is truthful | `demo-direct`/`demo-deferred` classifications and repeated explicit store-proof boundary | Repository wording + export proof |

## Verification results

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with zero warnings. |
| `npm test -- --runInBand` | Passed: 7 suites, 101 tests. |
| `npm test -- --runInBand --coverage` | Passed: 89.88% statements, 82.21% branches, 91.62% functions, 92.57% lines. |
| Web/default `npx expo config --type public --json` | Passed with only `expo-font`; native providers disabled. |
| Native missing Branch config probe | Failed as intended. |
| Local Android native config probe | Passed with Android-only ignored-file fallback and all expected provider plugins. |
| EAS-worker Android JSON-only probe | Passed; Android path present, iOS path absent. |
| EAS-worker iOS plist-only probe | Passed; iOS path present, Android path absent. |
| EAS-worker missing platform file probes | Failed as intended for Android missing JSON and `all` missing plist. |
| Invalid native platform probe | Failed as intended. |
| `npx expo-doctor` | Passed: 21/21 checks. |
| `npm run build:web` | Passed; Expo exported `dist` from 603 modules. |

Coverage is a gap signal, not a completeness claim. Against the supplied 22-test baseline, aggregate statements increased from 79.86% to 89.88% (+10.02 points), branches from 77.19% to 82.21% (+5.02), and functions from 63.63% to 91.62% (+27.99). Against commit `7239fd2`, statements increased 0.75 points, branches 3.36, functions 5.71, and lines 1.48 while the suite grew from 82 to 101 tests. The expanded coordinator and tracker now report 91.33% and 92.92% statements respectively; the lower per-file percentages than the first audit reflect substantial new lifecycle/timeout paths, not removed behavior proof. Storage reports 84.52% statements, 77.04% branches, and 93.97% functions; tests prioritize the reviewed atomicity, expiry, epoch, invalid-cleanup, outbox, and receipt races rather than a vanity percentage.

## External proof boundary

No repository test or `expo config --type public` output proves config-plugin mods, generated Android/iOS projects, native compilation, SDK binary loading, signing identities, Android `assetlinks.json`, iOS AASA/entitlements, real Branch credentials/dashboard routing, a physical cold/warm callback, a store-mediated app-not-installed → install → first-launch handoff, Firebase DebugView/warehouse ingestion, global referral-code uniqueness, production authentication, authoritative account creation, fraud rules, or transactional rewards. Those checks require Mal-owned projects, signed builds, physical devices, Play internal testing/TestFlight, and a real backend.
