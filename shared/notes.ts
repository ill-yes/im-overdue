import type { CalendarNote, NoteScope } from './types.js';

export const NOTE_MAX_LENGTH = 5000;

export function noteText(notes: CalendarNote[], scope: NoteScope, date: string): string {
  return notes.find(note => note.scope === scope && note.date === date)?.text ?? '';
}
