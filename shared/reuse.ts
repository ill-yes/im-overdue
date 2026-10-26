import type { ReusableInput } from './types.js';

export const REUSABLE_TITLE_MAX_LENGTH = 160;
export const REUSABLE_NOTE_MAX_LENGTH = 2000;
// Seven local days can exceed 168 elapsed hours when the UTC offset moves back.
// Temporal offsets are bounded to less than 24 hours in either direction.
export const REUSABLE_DURATION_MAX_MINUTES = 7 * 24 * 60 + 48 * 60;

export function reusableKey(input: ReusableInput): string {
  return JSON.stringify([input.title.trim(), input.note.trim(), input.durationMinutes]);
}
