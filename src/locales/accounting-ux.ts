import type { Messages } from '../i18n';

export const accountingUxMessages = {
  editOpening: { en: 'Edit opening balance', de: 'Anfangsbestand ändern' },
  addAbsence: { en: 'Add absence', de: 'Abwesenheit eintragen' },
  timesheet: { en: 'Timesheet', de: 'Stundenzettel' },
  credits: { en: 'Credits', de: 'Gutschriften' },
  vacation: { en: 'Vacation', de: 'Urlaub' },
  sickness: { en: 'Sickness', de: 'Krankheit' },
  holidays: { en: 'Public holidays', de: 'Feiertage' },
  creditBreakdown: { en: 'Credits included in the balance', de: 'Im Saldo enthaltene Gutschriften' },
  balanceRule: { en: 'Work + credits − target = balance. Time off in lieu reduces the balance; it is not an extra deduction.', de: 'Arbeit + Gutschriften − Soll = Saldo. Freizeitausgleich verringert den Saldo; er wird nicht zusätzlich abgezogen.' },
} satisfies Messages;
