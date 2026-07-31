# Mal Referral Flow — Design System

This file is the visual source of truth for the assessment prototype. It combines the UI/UX Pro Max recommendations with a brand override grounded in Mal's supplied lockup and public product language. The generated gold/crypto palette was intentionally rejected because it did not match Mal.

## Product thesis

**Mal Trust Loop:** a calm, premium referral journey that makes attribution feel continuous and protected. The customer experience leads; reviewer controls and telemetry remain available as secondary evidence.

## Brand foundations

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#F6F8FC` | `#0F0C17` | App background |
| Surface | `#FFFFFF` | `#171320` | Primary cards |
| Surface muted | `#EEF2F8` | `#292234` | Inputs and quiet regions |
| Brand mist | `#D0DDEE` | `#D0DDEE` | Official lockup tile/splash only |
| Ink | `#373638` | `#FAF8FF` | Primary text |
| Muted ink | `#5E5B67` | `#C4BDCF` | Body/supporting text |
| Violet | `#7032FF` | `#8D68FF` | Active states and focus |
| Deep violet | `#4D1FC6` | `#C5B7FF` | Accessible accent text |
| Lilac | `#A67DFE` | `#B79CFF` | Decorative gradient only |
| Pink | `#A950DF` | `#D58AF0` | Decorative gradient only |
| Cyan | `#2A94D4` | `#67C6F5` | Decorative gradient only |
| Success | `#066B50` | `#6DDEB8` | Confirmed milestones |
| Danger | `#A91F38` | `#FF8DA1` | Failure and rejection |

Primary CTA gradient: `#5222C8 → #2858B9` in light mode and `#633ED6 → #2854AE` in dark mode. Bright pink/cyan never carry small white text.

## Typography

- Geometric system sans stack matching the Mal wordmark's clean character.
- Display: 36/41 mobile, 46/51 desktop, weight 800.
- Card title: 25–29px, weight 800.
- Body: 15–16px with 1.5–1.6 line height.
- Labels: 10–11px only when uppercase and supplemental; never for body instructions.
- Referral codes and event identifiers use the platform monospace stack with tabular figures.

## Shape and spacing

- 4/8dp rhythm; primary gaps 16, 24, 32, 48.
- Hero cards: 32px radius.
- Standard cards: 24px radius.
- Controls and inputs: 16px radius; CTAs may use pill geometry.
- Touch targets: minimum 48px.
- Borders use semantic tokens; no low-contrast white-on-white boundaries.

## Signature detail

The **referral orbit** uses five nodes mapped to the five required funnel events. A segmented inner rosette references Mal's emblem without replacing or modifying the official lockup. Nodes illuminate only when the corresponding analytics milestone is accepted.

## Motion

- Press feedback: 140ms scale to 0.975, spring release.
- Status feedback: 220ms opacity + translateY up to 8px.
- Route/content reveal: 320–360ms opacity + translateY up to 12px.
- Stagger: 44ms between related items.
- Success/orbit sequence: finite, state-driven, transform/opacity only.
- Easing: `Bezier(0.16, 1, 0.3, 1)`.
- No looping decoration, confetti, parallax, or animation-triggered business logic.
- Reduced motion: content appears immediately and navigation animation is disabled.

## Hierarchy

1. Customer job and primary CTA.
2. Referral identity and reassurance.
3. Status feedback.
4. Reviewer controls and analytics trace.

On phones, technical evidence is collapsed behind a labeled control. On desktop, it becomes a lower-emphasis side rail.

## Accessibility and QA

- Text contrast: 4.5:1 minimum; non-text focus/control boundaries: 3:1 target.
- Visible keyboard focus on all buttons.
- Semantic labels, loading/disabled states, local field errors, and focus-to-first-invalid-field.
- Test at 375px, landscape, 768px, 1024px, and 1440px.
- Test light/dark independently and at 200% zoom/dynamic type.
- Respect safe areas and reduced-motion settings.
- Use Feather consistently for interface icons; no emoji controls.
