import type { Messages } from './i18n.js';

export const timesheetMessages = {
  name: { en: 'Name', de: 'Name' },
  date: { en: 'Date', de: 'Datum' },
  status: { en: 'Status', de: 'Status' },
  actualMinutes: { en: 'Work (minutes)', de: 'Ist (Minuten)' },
  vacationMinutes: { en: 'Leave (minutes)', de: 'Urlaub (Minuten)' },
  targetMinutes: { en: 'Target (minutes)', de: 'Soll (Minuten)' },
  balanceMinutes: { en: 'Balance (minutes)', de: 'Saldo (Minuten)' },
  workingTimes: { en: 'Working times', de: 'Arbeitszeiten' },
  titles: { en: 'Titles', de: 'Titel' },
  blockNotes: { en: 'Block notes', de: 'Blocknotizen' },
  dayNote: { en: 'Day note', de: 'Tagesnotiz' },
  weekNote: { en: 'Week note', de: 'Wochennotiz' },
  closed: { en: 'Confirmed', de: 'Bestätigt' },
  open: { en: 'Provisional', de: 'Vorläufig' },
  untouched: { en: 'Untouched', de: 'Unberührt' },
  confirmedTotal: { en: 'Confirmed total', de: 'Summe bestätigt' },
  provisionalTotal: { en: 'Provisional total', de: 'Summe vorläufig' },
  touchedDaysOnly: { en: 'Touched days only', de: 'Nur berührte Tage' },
} satisfies Messages;
