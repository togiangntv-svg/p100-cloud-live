# Implementation Note — Opening → Body Goal Flow

Date: 2026-09-12  
Scope: the narrow opening-to-body-goal slice only. No route, plan, chat action, AI action, permission, reset, or publish step was added after the goal screen.

## Audit before this fix

The starting implementation at `e0dd48c` already mounted `OpeningGoalFlow` at the root and kept the old Today/chat experience behind the opening layer. The body-goal text was stored locally and was not sent to `InteractionContext`, an API, an AI model, or a provider.

The acceptance run reproduced these issues:

- Reduce Motion could leave the logo button disabled while waiting for an animation callback.
- Opening copy/logo and the goal panel changed at nearly the same time instead of using staged scene timing.
- The bright frame already present in `icon.png` was too prominent.
- The square sunrise image placed the sun/horizon behind the panel.
- Vietnamese opening copy still used the old lead line.
- The four chips could collapse at 320×568.
- Reload after entering a goal draft could return to the old chat instead of the goal screen.
- Review from Settings needed to reach the goal screen and still close cleanly.
- The background pause control did not control a visible background animation.

## Checkpoints

- Before: tag `checkpoint-before-opening-flow-fix-20260912`, commit `e0dd48c`.
- After: tag `checkpoint-after-opening-flow-fix-20260912`, created on the final verified workspace commit.
- Before the Founder-approved target refinement: tag `checkpoint-before-target-refinement-20260912`, commit `833452a9b51b28398a3d0934c45c5b4342bb296e`.
- After the target refinement: tag `checkpoint-after-target-refinement-20260912`, created on the final verified workspace commit.
- Before the logo-animation repair: tag `checkpoint-before-logo-animation-repair-20260912`, commit `4c5785f9f7c5a99840ffbabf138140b62f11dc33`.
- After the logo-animation repair: tag `checkpoint-after-logo-animation-repair-20260912`, created on the final verified workspace commit.
- Before the sunrise-scene repair: tag `checkpoint-before-sunrise-scene-repair-20260912`, commit `c235c518aedaac650d8be5b5a57685cdf8f18bd6`.
- After the sunrise-scene repair: tag `checkpoint-after-sunrise-scene-repair-20260912`, created on the final verified workspace commit.
- Before the ExpoGo/preview cold-start repair: tag `checkpoint-before-cold-start-opening-repair-20260912`, commit `cb49dabb29513d0db115d5396082074674c618df`.
- After the ExpoGo/preview cold-start repair: tag `checkpoint-after-cold-start-opening-repair-20260912`, created on the final verified workspace commit.

## Implementation

### Opening interaction and motion

- The logo button is enabled as soon as the interface mounts. It no longer depends on `logoReady`.
- The Reduce Motion and interruption paths still complete the logo callback, but that callback is visual state only.
- Normal motion now runs in stages:
  1. logo press settles;
  2. opening copy/logo fade away;
  3. the sunrise scene brightens;
  4. the scene remains visible before the panel;
  5. the goal panel appears.
- The opening layer stays mounted until its fade actually finishes.
- Reduce Motion uses the same order with short, light transitions.
- Background/resume or tab interruption completes the transition safely instead of leaving an invisible blocking layer.
- The unused background pause control and its infinite loop were removed.

### Logo frame

- `icon.png` and the 100 stroke/mask are unchanged.
- Only the outer frame region is covered with the existing dark logo surface.
- A separate low-opacity frame token and short shimmer sit above it.
- No circular halo or replacement glyph was added.

### Logo-animation lifecycle repair

- The reproduced stall came from the draw effect depending on the identity of the parent `onDrawComplete` callback. A hydration, locale, or other parent-state render changed that inline callback, cleanup canceled the active frame, and the retained “already started” flag prevented a replacement frame loop.
- The animation now keeps the latest completion callback in a ref. The frame effect depends only on motion state, so ordinary parent renders do not cancel the draw.
- The one-way “already started” guard was removed. A real motion-mode change can now cleanly complete or start the appropriate path instead of leaving the logo between states.
- Fallback dash lengths match the measured SVG geometry (approximately 3408 for the signature trace and 3919 for the border). This prevents dash repetition from revealing the final loop before the trace reaches it.
- The existing Founder image, stroke path, mask, draw duration, settle duration, and tap-to-continue behavior remain in use. No static replacement was introduced.

### Scene and layout

- `welcome-sunrise.png` remains the only scene source. No generated image or replacement asset was added.
- The previous synthetic sun core/halo/glow was removed. The visible sun and reflection now come only from the source photograph.
- The previous full-screen duplicate image with large X/Y translations was removed. A single, clipped scene image covers the viewport width with an aspect-preserving square size, preventing desktop side gaps and vertical seams.
- The crop uses the measured source-sun position `(653, 799)` and clamps its vertical offset so the scene always covers its window.
- The same scene is dim but visible during opening, then rises 18px and brightens continuously after the logo tap. There is no white flash or second sun.
- Normal motion gives the sunrise its own beat: the scene is effectively complete near 2.2 seconds, remains without the panel through 3.3 seconds, and the panel completes near 4.1 seconds.
- The goal overlay is warmer and lighter. A matching opaque lower fade removes the image-to-background join while preserving contrast for the panel.
- Compact height uses a shorter panel, question, and input. Suggestion touch targets remain at least 44px.
- Chips keep two columns with explicit row/column gaps at 320×568.
- The keyboard-aware scroll container remains available when the keyboard or larger text increases content height.

### Persistence and review

- Entering the first-run goal screen stores a local flow marker in addition to the local draft.
- In the canonical production decision, hydration resumes the goal screen when the marker or a non-empty draft exists.
- In that canonical production decision, reload does not replay the full opening and does not expose the old chat as the active screen.
- Opening from Settings in review mode does not write the first-run resume marker.
- Review can reach the goal screen and close back to Settings.

### ExpoGo/preview slice cold-start policy

- The previous two persistence bullets describe the canonical product decision only. They no longer control the acceptance-slice startup while running the development ExpoGo/web-preview bundle.
- In the development ExpoGo/web-preview runtime, every fresh provider mount or page reload starts at the opening phase, regardless of saved welcome state, goal-flow marker, goal draft, legacy local state, or selected locale.
- The policy is gated by the React Native development-runtime constant. A production bundle continues to use the canonical saved-state decision; this change does not redefine the wider product journey.
- Hydration completes before the overlay is rendered, and the preview launch decision always supplies `opening`, so the goal panel cannot flash before the signature screen.
- Saved goal text, locale, and all other local data are read but never cleared. After the user waits for the complete signature, taps the logo, and watches the sunrise, the saved goal text appears in the goal input.
- Settings review also starts from the opening phase, including when a goal marker or draft exists.
- Background/foreground changes and keyboard focus changes do not remount the provider or reset the flow. If the app backgrounds during an already-started transition, the existing interruption safeguard completes that transition rather than replaying it.

### Copy

- Vietnamese lead: `Một trăm năm sống rực rỡ`.
- Vietnamese tagline: `Cùng bạn, mỗi ngày.`
- English lead: `A hundred years, lived brightly`.

### Founder-approved target refinement

- The original `icon.png` is shown at the physical top-left of the target screen; the language control remains at the physical top-right in both LTR and RTL locales.
- The target panel is compact, translucent, and bounded to the safe horizontal inset.
- The Vietnamese question uses the system font without artificial letter spacing, avoiding broken spacing around diacritics.
- The input has a restrained light-gradient border and a stronger focus state while remaining a free-form multiline input.
- Four semantic vector icons accompany the health, fat-loss, muscle, and body-shape suggestions.
- Each suggestion has a physical press-in state and returns to its resting position on release. Selection has a distinct warm border/surface.
- Pressing a suggestion fills and focuses the input. The user can edit or replace the suggestion immediately.
- The natural photographic sun and reflection remain visible above the panel at 320×568 and 390×844. The source landscape is unchanged and keeps its aspect ratio.
- No route, next action, coaching flow, plan, chat, AI action, or provider call was added.

### Opening/target localization

The opening and target slice now has complete copy for:

`vi`, `en`, `zh-Hans`, `ja`, `ko`, `es`, `pt`, `ru`, `th`, `id`, `hi`, `bn`, `ur`, `ar`, `fr`, `de`, `tr`, `it`, `fil`, and `fa`.

- The menu presents all 20 languages by native name and supports scroll and search on a 320px-wide screen.
- Urdu, Arabic, and Persian use RTL text/input direction. The brand logo and language menu do not swap physical sides.
- A valid saved choice has priority.
- When there is no valid saved choice, only the device/browser language tag is considered. The region is not treated as proof of the user's country and does not force a multilingual country to one language.
- An unsupported locale falls back to English and the invalid stored value is replaced with `en`.
- Changing locale does not translate, mutate, or clear the goal draft.
- Translation expansion is limited to opening/target and related review/close labels. Existing app copy outside this slice falls back to English for the 18 new locales.
- Existing AI request schemas remain `vi/en`; the non-Vietnamese compatibility boundary stays English. The local goal draft is still absent from AI request context.

## Files changed

- `app/_layout.tsx`
- `components/OpeningGoalFlow.tsx`
- `components/WelcomeLogoAnimation.tsx`
- `constants/colors.ts`
- `context/InteractionContext.tsx`
- `context/LocalizationContext.tsx`
- `context/WelcomeContext.tsx`
- `domain/opening.ts`
- `i18n.ts`
- `i18n-opening.ts`
- `scripts/verify-opening.mjs`
- `IMPLEMENTATION_NOTE_OPENING_FLOW.md`
- `ACCEPTANCE_CHECKLIST_OPENING_FLOW.md`

## Verification actually run

Commands:

```text
pnpm --filter @workspace/human-development-intelligence run typecheck
pnpm --filter @workspace/human-development-intelligence run verify:welcome
pnpm --filter @workspace/human-development-intelligence run verify:opening
pnpm --filter @workspace/human-development-intelligence run verify:interaction
```

Results:

- TypeScript: PASS.
- Welcome persistence and existing-journey bypass: PASS.
- Opening domain plus goal-screen phase/draft resume: PASS.
- Interaction consent/context regression checks: PASS.
- Opening translation verification:
  - exactly 20 unique locale IDs;
  - every opening/target key is non-empty in every locale;
  - RTL metadata is limited to `ur`, `ar`, and `fa`;
  - unsupported locale IDs are rejected.
- Chromium runtime matrix at 320×568 and 390×844:
  - all 20 localized questions and four localized suggestion labels are rendered;
  - the draft remains byte-for-byte unchanged through each locale switch;
  - input direction is RTL only for Urdu, Arabic, and Persian;
  - logo left edge remains 16px and language menu right edge remains 16px;
  - four suggestions remain two columns by two rows in every locale;
  - all four suggestions remain inside the viewport.
- Real Chromium mouse press:
  - press-in reached approximately `scale(0.963) translateY(2px)`;
  - release returned to `scale(1) translateY(0px)`;
  - release filled and focused the input;
  - selected border remained visible.
- Invalid saved locale runtime check: UI and stored choice both fall back to English.
- Reduced Motion runtime check: the target input and all four suggestions remain available after reload.
- Chromium at 320×568 with Reduce Motion:
  - opening logo exists and is not disabled;
  - target input and question appear after tap;
  - four chip rectangles form two columns and two rows;
  - chip fills the input and user text remains editable;
  - reload returns to the goal screen with the edited draft;
  - no POST request was recorded.
- Chromium sunrise transition with normal motion:
  - the complete logo and invitation were present before the real tap;
  - at +700 ms the opening had retracted and the panel remained at opacity `0`;
  - at +2.20 s the natural sunrise scene was approximately `0.999` while the panel remained at `0`;
  - at +3.30 s the scene remained fully visible and the panel was still `0`;
  - at +4.10 s the scene and panel were both `1`;
  - no POST request was recorded.
- Settings review:
  - `/privacy` opens without first welcome for an existing user;
  - `review-welcome` opens the introduction;
  - the logo reaches the goal screen;
  - `welcome-close` returns to Settings;
  - no POST request was recorded.
- Repaired logo draw at 390×844 with normal motion:
  - sampled draw progress was `0.0000`, `0.1404`, `0.3070`, `0.4912`, `0.7544`, and `1.0000`;
  - a locale switch to Vietnamese occurred during the draw and progress continued;
  - the first sampled frame showed only the starting stroke; at about 49% the first loop was still incomplete; at about 75% the final loop had only begun;
  - tap-hint opacity remained `0` while drawing, began settling only after draw progress reached `1`, and reached `1` after settle;
  - shimmer opacity remained `0` during drawing and increased only after completion;
  - the target input remained absent until a real logo press; press-in produced a visible scale response and release opened the target.
- Two consecutive Settings reviews:
  - both started at draw/settle `0/0`, including while a saved draft hydrated;
  - both completed at `1/1` in approximately 2.22 seconds;
  - neither review advanced before a tap.
- Reduce Motion review:
  - opened at draw/settle `1/1`, with the complete logo and hint visible;
  - did not render the animated trace;
  - kept the logo button enabled.
- Sunrise composition runtime evidence:
  - screenshots were inspected at 320×568, 390×844, 985×600, and 1280×720 for opening, sunrise-only, and final-panel states;
  - opening showed a dim mountain/horizon layer instead of a flat empty field;
  - every goal screenshot showed one photographic sun with continuous mountains/lake and no synthetic circle, concentric rings, vertical seam, or dark side strip;
  - the compact 320×568 panel started at y=306 with height 240, leaving the sun and reflection above it;
  - 320×568 suggestion heights were 44–46px;
  - 320×568 kept the header logo 16px from the left and the language menu 16px from the right;
  - both desktop crops kept the sun and reflection above the panel.
- Reduce Motion sunrise check at 320×568:
  - logo draw/settle and hint were immediately `1/1/1`;
  - scene and panel reached opacity `1` within the short reduced-motion path;
  - the animated logo trace was absent.
- ExpoGo/preview cold-start logic and web runtime:
  - clean storage, saved welcome, saved goal-flow marker, saved `Vóc dáng` draft, saved Vietnamese locale, and a combined saved-state case all opened at draw/settle `0/0`;
  - none of those root reloads rendered the goal input or recorded a goal-input mutation before the logo tap;
  - the combined case preserved `Vóc dáng` and `vi` before the tap, then restored both after the complete signature and sunrise transition;
  - 120ms after the tap the opening remained mounted and the panel stayed at opacity `0`;
  - focus/blur of the goal input and a web frozen/active lifecycle cycle kept the goal screen and draft unchanged;
  - reloading the root after completing the flow returned to draw/settle `0/0` while retaining the draft and locale.
- Native bundle verification:
  - Expo export produced an iOS Hermes bundle from 1,929 modules;
  - Expo export produced an Android Hermes bundle from 2,010 modules;
  - no dependency, native plugin, provider, permission, or API change was made.

Observed web-development warnings are pre-existing React Native Web warnings. The app also performs an existing GET status probe to `/api/ai/status`; no POST, model call, or provider call occurred in these checks.

Expo remained available after the final workflow restart:

```text
exp://ec87068b-9834-4027-8871-941eb6547441-00-2qzzoke921woa.expo.sisko.replit.dev
```

## Not marked as Founder PASS

These remain Founder/device acceptance items:

- Founder confirms a real iPhone ExpoGo cold start from the root QR begins at the signature screen even with the previously saved `Vóc dáng` draft;
- Founder confirms background/foreground and keyboard open/close do not replay or reset the flow on the physical iPhone;
- Founder approval of the repaired natural-sunrise composition, brightness, and approximately four-second scene beat on physical iPhone and Android devices;
- Founder confirmation of the repaired signature draw, post-draw shimmer, and tap invitation on physical iPhone and Android devices;
- final logo frame brightness and shimmer feel on a physical iPhone and Android device;
- final sunrise composition and scene timing by visual judgment;
- keyboard behavior with a real mobile keyboard;
- CJK, Thai, Indic, Urdu, Arabic, and Persian font rendering on physical iPhone and Android devices;
- RTL cursor, selection handles, and software-keyboard behavior on physical devices;
- VoiceOver/TalkBack focus and large-text behavior on physical devices;
- app icon clipping and long-lived iPhone installation/QR checks tracked separately.

Locale is not country evidence. No IP lookup, GPS, location permission, or external geolocation service was added or tested.

## v05 art-kit implementation — 2026-09-12

Scope remained limited to the opening and target screen. The supplied
`100_V05_ART_KIT_v1` was verified before source changes:

- `100-v05-sunless-scene-v1.png` is the only runtime scene plate;
- `100-v05-sunrise-reference-v1.png` is stored for art comparison only and is
  not imported by runtime code;
- both files are 853×1844 and their SHA-256 hashes match the supplied manifest;
- the assets are reconstructed candidates, not original video source frames and
  not yet Founder-approved.

The v05 runtime treatment now:

- covers the complete viewport with one continuous sunless lake scene from
  opening through goal;
- draws the Founder signature sequentially for approximately 2.68 seconds,
  followed by a short settle to approximately 3 seconds total;
- reveals the tap invitation directly below the logo before the title;
- waits indefinitely for a real press and gives the logo a short mechanical
  compression response;
- retracts copy before the logo;
- animates exactly one separate sun upward from behind the measured ridge in the
  same crop coordinate system as the scene;
- gives the sunrise approximately 3.2 seconds plus an independent 0.85-second
  scene hold before the bottom panel enters;
- keeps the final logo at physical left and the language selector at physical
  right;
- uses a thin serif display face for opening and target copy with platform glyph
  fallback for the full locale set;
- keeps the goal panel near 38–40% of a 390×844 viewport, with a centered
  question, low expanding input, and four two-column icon suggestions.

The video phone shell was not added. The reference image with its built-in sun
is never layered into the runtime, so a second sun cannot be produced by asset
stacking. No route, provider, permission, AI call, persistence contract, locale,
RTL rule, or post-goal feature changed.

Validation completed:

- TypeScript typecheck: PASS.
- Welcome cold-start/lifecycle verification: PASS.
- Opening locale, persistence, asset-role, one-sun-coordinate, and timing
  verification: PASS.
- Chromium 390×844 opening → real tap → sunrise → goal: completed.
- The browser run confirmed one visible sun aligned with the water reflection,
  full-height continuous scenery, no automatic transition, bottom-panel
  proportions, four icon suggestions, and editable retained `Vóc dáng`.
- The same run identified a rounded-focus/frame presentation issue and an
  Animated opacity issue on the language control; both were fixed directly
  afterward and rechecked by typecheck and source regression.
- No provider or model was called.

`NATIVE_NOT_TESTED`: no physical iPhone or Android device was available to this
implementation session. HTTP/bundle/web evidence is not a native PASS. Founder
must run the Expo Go flow from cold opening through goal and explicitly approve
the reconstructed art, sun/ridge illusion, timing, fonts, keyboard, RTL, and
large-text behavior.

### iPhone transition hotfix — 2026-09-12

Founder reported that the target question and four suggestions did not appear
after tapping on iPhone. The press-release spring and the transition sequence
were both writing to the same logo scale animation. A native `onPressOut` could
therefore interrupt the sequence callback before the sunrise and panel sequence
started. The mechanical scale recovery is now independent, and release events
are ignored after the guarded transition has started. Typecheck, welcome
verification, and opening verification pass after the fix.

### UX-OPENING-V06.1 refinement — 2026-09-13

- The post-draw invitation is finite: one glow pulse, two restrained
  press/release cues, one delayed reminder, then no continuing loop.
- The visible tap instruction was removed; its localized text remains only as
  the logo button's accessibility label.
- Sunrise and panel reveal now run together. The environment brightens over
  2.4 seconds while the panel begins its smooth rise after 200 ms, without a
  spring or bounce.
- The free-text field is larger and more readable. Suggestion chips retain
  accessible touch targets but are smaller, lighter, and recede gently while
  the user types.
- The existing sunless scene, separate sun layer, Founder logo paths, local
  draft, 20 locales, RTL behavior, review flow, and native press-release guard
  remain in place. No new visual asset or provider call was introduced.
- The Settings tab keeps its route and review control but uses a smaller,
  unfilled, muted gear treatment.

`NATIVE_NOT_TESTED` remains in force until Founder approves this V06.1 motion
on an iPhone through Expo Go.

### Persistent mechanical invitation and global signature — 2026-09-13

- After its initial draw, the framed opening logo now repeats a restrained
  mechanical press/release motion until the user's tap is accepted. The
  existing transition guard stops that loop before sunrise begins.
- Outside the opening, every shared `BrandLogo` renders the Founder `100` path
  progressively from `1` through both zeroes, remains complete for 10 seconds,
  then redraws. The goal header uses the same component.
- The signature performs no frame updates during the 10-second rest, stops
  while the app is inactive, and becomes static when Reduce Motion is enabled.
- The opening's static/error fallback explicitly opts out of the global
  signature cycle.

### Founder approval lock — 2026-09-13

Founder approved and closed Screen 1 (opening) and Screen 2 (goal entry),
including the persistent mechanical opening invitation and the shared
`1 → 0 → 0 → rest 10 seconds` signature cycle. Preserve this baseline while
Screen 3 is designed separately; do not alter Screens 1–2 as part of Screen 3
work unless Founder explicitly reopens them.