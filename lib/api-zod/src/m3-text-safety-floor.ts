import type { M3Locale } from "./m3-locales";
import type { SafetyState } from "./m3-meaning";
import { evaluateTrainerSafetyText } from "./trainer-safety-policy";

// A bounded recognition floor, not a symptom checker or a statement of medical
// safety. CLEAR means only that these specific rules did not elevate the text.
// No input text is retained and no action or permission is issued here.
export function deriveM3TextSafetyFloor(locale: M3Locale, currentText: string): SafetyState {
  return evaluateTrainerSafetyText(locale, currentText).level;
}
