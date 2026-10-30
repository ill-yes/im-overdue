import type { Messages } from '../../shared/i18n.js';

export const absenceSummaryMessages = {
  holidayReview: { en: 'Review public holiday', de: 'Feiertag prüfen' },
  holidayReviewDetail: { en: 'Historical rule unresolved; use the holiday settings.', de: 'Historische Regel ungeklärt; in den Feiertagseinstellungen prüfen.' },
  absences: { en: 'Absences', de: 'Abwesenheiten' },
  absencesFor: { en: 'Absences on {date}', de: 'Abwesenheiten am {date}' },
  holiday: { en: 'Public holiday', de: 'Feiertag' },
  sickness: { en: 'Sick leave', de: 'Krankheit' },
  compensation: { en: 'Time off in lieu', de: 'Freizeitausgleich' },
  vacation: { en: 'Leave', de: 'Urlaub' },
  halfVacation: { en: '½ day of leave', de: '½ Urlaub' },
  unused: { en: '{duration} unused', de: '{duration} ungenutzt' },
  suspended: { en: 'suspended on public holiday', de: 'am Feiertag ausgesetzt' },
  credited: { en: '{duration} credited', de: '{duration} Gutschrift' },
  compensationUsed: { en: '{duration} used', de: '{duration} Abbau' },
  workLegend: { en: 'Working time and absence credits are separate', de: 'Arbeitszeit und Abwesenheitsgutschriften getrennt' },
  footnote: {
    en: 'Personal time account, without employer approval. Public holidays, leave and sick leave are credited separately. Time off in lieu reduces the balance; breaks are not added automatically.',
    de: 'Persönliches Zeitkonto, keine Arbeitgeberfreigabe. Feiertage, Urlaub und Krankheit werden separat gutgeschrieben. Freizeitausgleich baut das Guthaben ab; Pausen werden nicht automatisch ergänzt.',
  },
} as const satisfies Messages;
