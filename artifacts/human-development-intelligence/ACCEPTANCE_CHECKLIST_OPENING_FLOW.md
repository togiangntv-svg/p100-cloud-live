# Acceptance Checklist — Opening → Body Goal Flow

Date: 2026-09-12

## Technical acceptance completed

- [x] Logo is the opening action; there is no separate large Begin button.
- [x] Logo tap is enabled immediately after mount.
- [x] Reduce Motion does not wait for animation completion before allowing tap.
- [x] Normal transition keeps the opening visible during its exit.
- [x] Scene brightening and the panel reveal are separate stages.
- [x] A visible scene beat occurs before the goal panel.
- [x] Interruption/background handling cannot leave the transition blocking input.
- [x] `icon.png` and the 100 stroke are unchanged.
- [x] Original image frame is dimmed without adding a circular halo.
- [x] Only a subtle frame shimmer remains after the draw.
- [x] Sunrise image keeps its aspect ratio.
- [x] Goal scene is brighter and warmer than opening.
- [x] Sun/horizon are positioned before the panel rather than under its center.
- [x] Vietnamese copy is `Một trăm năm sống rực rỡ` and `Cùng bạn, mỗi ngày.`
- [x] 320×568 keeps four chips in two columns and two rows.
- [x] Keyboard-aware scrolling remains enabled for short screens and larger content.
- [x] A chip fills the input.
- [x] Chip-filled text remains user-editable.
- [x] Goal draft remains local.
- [x] Reload resumes the goal screen with the draft.
- [x] Reload does not replay the full opening.
- [x] Goal draft is not added to `InteractionContext`.
- [x] Goal draft is not sent to an API, model, or provider.
- [x] Review from Settings reaches the goal screen.
- [x] Review goal screen can close back to Settings.
- [x] Review mode does not create a first-run resume marker.
- [x] Unused background pause control and infinite loop are removed.
- [x] Typecheck passes.
- [x] `verify:welcome` passes.
- [x] `verify:opening` passes.
- [x] `verify:interaction` passes.
- [x] Chromium acceptance recorded zero POST requests.
- [x] Original `icon.png` appears at the physical top-left of the target screen.
- [x] Language menu remains at the physical top-right for LTR and RTL.
- [x] Language menu lists 20 languages by native name and can scroll/search on 320px width.
- [x] Opening/target copy is complete for all 20 approved locales.
- [x] Unsupported saved locale falls back to and persists English.
- [x] Saved locale takes priority over device/browser language.
- [x] Locale detection uses the real language tag without inferring country from region.
- [x] Urdu, Arabic, and Persian content/input use RTL.
- [x] Changing locale preserves the goal draft exactly.
- [x] Translation expansion is limited to opening/target and related review labels.
- [x] Vietnamese target typography has no artificial diacritic spacing.
- [x] Input has visible border/light focus treatment and remains free-form.
- [x] Four suggestions use semantic vector icons.
- [x] Real mouse press visibly lowers/scales a suggestion and release restores it.
- [x] Suggestion selection is visually distinct.
- [x] Suggestion press fills and focuses the input.
- [x] All 20 locales keep the suggestions 2×2 at 320×568 and 390×844.
- [x] The natural photographic sun and reflection remain visible above the target panel.
- [x] Parent hydration, state changes, and locale changes do not cancel the active logo draw.
- [x] The final 0 loop is not revealed before the trace reaches its final segment.
- [x] Tap invitation stays visually hidden until the draw completes.
- [x] Post-draw shimmer begins only after the logo completes.
- [x] The opening does not advance without a logo tap.
- [x] Two consecutive Settings reviews each restart from zero and complete.
- [x] A saved draft hydrating during review does not stall the animation.
- [x] Reduce Motion shows the complete logo immediately and keeps it interactive.
- [x] The repaired animation still uses the Founder image with the existing stroke/mask, not a static substitute.
- [x] Opening shows dim photographic dawn depth rather than a flat near-black field.
- [x] The sunrise and reflection come from the existing source image; no synthetic sun, halo, rings, or second sun remain.
- [x] Goal scene uses one aspect-preserving image layer without desktop side gaps or vertical seams.
- [x] Normal motion keeps the completed sunrise visible without the panel through approximately 3.3 seconds after tap.
- [x] Final panel stays low enough to leave the natural sun visible at 320×568, 390×844, 985×600, and 1280×720.
- [x] Compact panel keeps all four suggestion touch targets at least 44px high.
- [x] Reduce Motion reaches the bright scene and final panel through a short transition.
- [x] Development ExpoGo/web-preview cold launch starts at the signature phase for clean and previously used local storage.
- [x] Saved welcome, goal-flow marker, goal draft, legacy local state, and selected locale cannot bypass opening in the acceptance-slice runtime.
- [x] The goal input does not render or flash before a real logo tap on root reload.
- [x] Saved goal draft and locale remain unchanged and reappear after the signature and sunrise sequence.
- [x] Settings review starts the signature from zero even when a goal marker or draft exists.
- [x] Keyboard focus/blur and background/foreground within the same web session do not replay or reset the flow.
- [x] The forced replay policy is development-runtime-only; canonical production launch logic remains intact.
- [x] iOS and Android Hermes bundles export successfully with the launch policy.

## Evidence

- Before checkpoint: `checkpoint-before-opening-flow-fix-20260912` at `e0dd48c`.
- After checkpoint: `checkpoint-after-opening-flow-fix-20260912`.
- Target refinement before checkpoint: `checkpoint-before-target-refinement-20260912` at `833452a9b51b28398a3d0934c45c5b4342bb296e`.
- Target refinement after checkpoint: `checkpoint-after-target-refinement-20260912`.
- Logo-animation repair before checkpoint: `checkpoint-before-logo-animation-repair-20260912` at `4c5785f9f7c5a99840ffbabf138140b62f11dc33`.
- Logo-animation repair after checkpoint: `checkpoint-after-logo-animation-repair-20260912`.
- Sunrise-scene repair before checkpoint: `checkpoint-before-sunrise-scene-repair-20260912` at `c235c518aedaac650d8be5b5a57685cdf8f18bd6`.
- Sunrise-scene repair after checkpoint: `checkpoint-after-sunrise-scene-repair-20260912`.
- Cold-start repair before checkpoint: `checkpoint-before-cold-start-opening-repair-20260912` at `cb49dabb29513d0db115d5396082074674c618df`.
- Cold-start repair after checkpoint: `checkpoint-after-cold-start-opening-repair-20260912`.
- Browser sizes checked: 320×568, 390×844, 985×600, and 1280×720.
- Motion settings checked: normal and `prefers-reduced-motion: reduce`.
- Normal timing samples:
  - +700 ms: panel opacity `0`;
  - +2.20 s: scene approximately `0.999`, panel `0`;
  - +3.30 s: scene `1`, panel `0`;
  - +4.10 s: scene `1`, panel `1`.
- Reduce Motion functional checks:
  - logo button `disabled=false`;
  - four chip positions were 2×2;
  - edited draft restored after reload.
- Locale runtime matrix:
  - 20/20 locales at 320×568;
  - 20/20 locales at 390×844;
  - four suggestions stayed 2×2 and inside the viewport;
  - Urdu, Arabic, and Persian used RTL while logo/menu sides remained fixed;
  - draft remained unchanged through locale switching.
- Mechanical press sample:
  - down: approximately `scale(0.963) translateY(2px)`;
  - up: `scale(1) translateY(0px)`;
  - input focused after release.
- Invalid stored locale was replaced by `en` and rendered English.
- Normal logo-draw samples at 390×844:
  - progress `0.0000 → 0.1404 → 0.3070 → 0.4912 → 0.7544 → 1.0000`;
  - Vietnamese was selected while drawing and progress continued;
  - screenshots showed only the starting stroke first, an incomplete first loop near 49%, the final loop beginning near 75%, and the complete logo after settle;
  - hint opacity stayed `0` during draw and reached `1` only after completion;
  - no target input appeared before a real logo press.
- Review restart samples:
  - review 1: `0/0 → 1/1` in approximately 2.22 seconds;
  - review 2: `0/0 → 1/1` in approximately 2.25 seconds;
  - a stored draft hydrated during both runs without a stall.
- Reduce Motion sample: complete `1/1` logo, no animated trace, visible invitation, enabled logo button.
- Sunrise visual matrix:
  - opening/final screenshots inspected at all four required viewport sizes;
  - one photographic sun and reflection remained visible;
  - no synthetic circle/rings, vertical seam, or dark side strip remained;
  - 320×568 panel measured y=306, height=240; suggestion buttons measured 44–46px;
  - 320×568 header logo/menu remained 16px from their physical sides.
- Current Reduce Motion 320×568 sample: logo/hint `1/1/1`, scene/panel `1/1` within the short path, no animated trace.
- Root-launch saved-state matrix:
  - clean, saved welcome, saved goal marker, saved `Vóc dáng`, saved Vietnamese locale, and combined legacy state each started at draw/settle `0/0`;
  - no goal input existed or flashed before the tap in any case;
  - after draw `1/1`, tap and sunrise, `Vóc dáng` and `vi` were restored unchanged;
  - a second root reload again began at `0/0` with the same saved draft and locale;
  - focus/blur and frozen/active lifecycle checks left the current goal screen unchanged.
- Native bundle evidence:
  - iOS Hermes export: PASS, 1,929 modules;
  - Android Hermes export: PASS, 2,010 modules.
- Expo used for the final preview: `exp://ec87068b-9834-4027-8871-941eb6547441-00-2qzzoke921woa.expo.sisko.replit.dev`.

## Founder/device acceptance still required

Do not mark these items PASS from automated or web-preview evidence:

- [ ] Founder approves logo frame brightness and shimmer on iPhone.
- [ ] Founder approves logo frame brightness and shimmer on Android.
- [ ] Founder approves the repaired 100 signature draw and post-draw tap invitation on physical iPhone and Android devices.
- [ ] Founder approves normal-motion pacing and the scene beat.
- [ ] Founder approves sunrise/sun/horizon placement.
- [ ] Founder approves the repaired single photographic sunrise, reflection, brightness, and seam-free crop on physical iPhone and Android devices.
- [ ] Founder confirms root-QR cold start in ExpoGo on the physical iPhone begins with the signature despite the saved `Vóc dáng` draft.
- [ ] Founder confirms iPhone background/foreground and keyboard open/close do not replay or reset the flow.
- [ ] Physical iPhone keyboard does not hide the input or chips.
- [ ] Physical Android keyboard does not hide the input or chips.
- [ ] Founder approves CJK, Thai, Indic, Urdu, Arabic, and Persian font rendering on a physical iPhone.
- [ ] Founder approves CJK, Thai, Indic, Urdu, Arabic, and Persian font rendering on a physical Android device.
- [ ] RTL cursor, selection handles, and software keyboard are approved on physical devices.
- [ ] VoiceOver focus order and close behavior are approved.
- [ ] TalkBack focus order and close behavior are approved.
- [ ] Large-text layout is approved on physical devices.
- [ ] App icon clipping, QR freshness, and long-lived iPhone installation tasks pass separately.

## Explicit non-actions

- [x] No local data reset.
- [x] No permission change.
- [x] No model/provider change.
- [x] No AI request added.
- [x] No publish/deploy action.
- [x] No route or feature added after the goal screen.
- [x] No IP lookup, GPS, location permission, or external geolocation service added.
- [x] Locale was not treated as proof of the user's real country.

## v05 reconstructed-art acceptance

- [x] The uploaded ZIP was present and inspected before source changes.
- [x] Runtime imports the supplied sunless plate, not the complete reference.
- [x] Complete sunrise reference remains comparison-only.
- [x] Runtime contains one animated sun layer.
- [x] Scene crop, sun x/y, and ridge clipping derive from the same rendered
      853×1844 coordinate system.
- [x] Lake scene covers the full viewport behind opening and goal.
- [x] No iPhone shell was added to the app.
- [x] Signature draws sequentially for approximately three seconds.
- [x] Tap invitation appears between logo and title.
- [x] Flow waits for a real logo press.
- [x] Copy retracts before the logo.
- [x] Sunrise has an independent scene beat before the target panel.
- [x] Target panel is approximately 38–40% high at 390×844.
- [x] Target question is centered and uses the display serif.
- [x] Input starts low, expands for text, and remains editable.
- [x] Four suggestions remain in a two-column icon grid with press feedback.
- [x] Goal header keeps bare signature left and language control right.
- [x] Twenty locales, manual locale selection, RTL metadata, and local draft
      persistence remain intact.
- [x] Development root reload still starts at opening without deleting data.
- [x] Background/foreground completion behavior remains session-local and does
      not remount the flow.
- [x] TypeScript typecheck passes.
- [x] Welcome verification passes.
- [x] Opening verification passes.
- [x] Chromium 390×844 completed opening → tap → sunrise → goal and retained an
      edited `Vóc dáng` draft after blur.
- [x] No browser console error occurred in the interaction run.
- [x] Native press release can no longer cancel the sunrise/panel continuation
      after the first accepted logo tap.

## UX-OPENING-V06.1

- [x] Main Founder `100` still uses the existing continuous stroke reveal.
- [x] Stroke glow is part of the finite draw/settle treatment; no invitation
      animation loops continuously.
- [x] Logo completion triggers one pulse, two tactile cues, and at most one
      delayed reminder.
- [x] No visible copy instructs the user to tap `100`.
- [x] A tap immediately starts the guarded transition.
- [x] Sunrise, atmosphere brightening, and panel rise are coordinated.
- [x] Panel enters upward with cubic easing and no spring bounce.
- [x] Small top-left `100` uses the finite panel entrance and then remains still.
- [x] Free-text input is visually primary and still accepts arbitrary language.
- [x] Four suggestions remain optional, accessible 2×2 shortcuts and recede
      gently during free-text entry.
- [x] Settings remains available with a quieter gear; “Xem lại mở đầu” is
      unchanged.
- [x] Reduce Motion retains navigation and meaning without repeated invitation.
- [x] Existing image and logo assets are reused; no raster sequence was added.
- [x] Founder PASS on V06.1 timing and visual hierarchy.

## Persistent `100` motion

- [x] Framed opening logo presses and releases repeatedly until an accepted tap.
- [x] Opening motion stops when the sunrise transition starts.
- [x] Shared small `100` draws continuously from `1` through both zeroes.
- [x] Completed small signature rests for 10 seconds before redrawing.
- [x] Goal header and shared app logos use the same signature component.
- [x] Opening fallback remains static and does not use the global signature loop.
- [x] Reduce Motion shows the small signature complete and static.
- [x] Signature pauses while the app is not active.
- [x] Founder PASS for both motions.
- [x] No AI/provider call, permission change, new post-goal feature, or publish
      action was made.

Native acceptance status: `NATIVE_NOT_TESTED`.

- [ ] Founder approves the reconstructed v05 scene on physical iPhone.
- [ ] Founder approves the reconstructed v05 scene on physical Android.
- [ ] Founder confirms the sun appears to emerge behind the mountain rather
      than float above it.
- [ ] Founder confirms the final sun size and reflection alignment.
- [ ] Founder confirms the approximately three-second signature draw and
      post-tap five-second pacing.
- [ ] Founder confirms the language control is visible and usable on the goal
      header.
- [ ] Founder confirms the native serif renders Vietnamese marks cleanly.
- [ ] Founder confirms keyboard, large text, VoiceOver/TalkBack, and RTL on
      physical devices before marking v05 PASS.