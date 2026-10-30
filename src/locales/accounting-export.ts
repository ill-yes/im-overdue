import type { Messages } from '../../shared/i18n.js';

export const accountingExportMessages = {
  credits: { en: 'Credits', de: 'Gutschriften' },
  creditExplanation: { en: 'Credits include leave, sickness and public holidays. Time off in lieu reduces the balance.', de: 'Gutschriften umfassen Urlaub, Krankheit und Feiertage. Freizeitausgleich mindert den Saldo.' },
  creditBreakdown: { en: 'Credits: leave {vacation} · sickness {sickness} · public holidays {holiday}', de: 'Gutschriften: Urlaub {vacation} · Krankheit {sickness} · Feiertage {holiday}' },
  includeAccount: { en: 'Include time account', de: 'Zeitkonto ergänzen' },
  downloadAccount: { en: 'Account CSV', de: 'Zeitkonto-CSV' },
  accountFilename: { en: 'time-account', de: 'zeitkonto' },
  accountTitle: { en: 'Time account', de: 'Zeitkonto' },
  balance: { en: 'Balance', de: 'Saldo' },
  accountScope: { en: 'Selected period · confirmed as of {date}. Independent of the closed-weeks filter.', de: 'Gewählter Zeitraum · bestätigt zum {date}. Unabhängig vom Filter für abgeschlossene Wochen.' },
  noOpening: { en: 'No opening balance is effective yet. A confirmed account balance cannot be calculated.', de: 'Noch kein Startsaldo wirksam. Ein bestätigter Kontostand kann nicht berechnet werden.' },
  futurePeriod: { en: 'This period has not started yet. Its opening and ending balances are not available; planned entries are shown separately.', de: 'Dieser Zeitraum hat noch nicht begonnen. Anfangs- und Endstand sind noch nicht verfügbar; geplante Buchungen stehen separat.' },
  openingDate: { en: 'Initial balance effective {date}', de: 'Startsaldo gültig ab {date}' },
  accountUnavailable: { en: 'No time account data in this snapshot.', de: 'Dieser Datenstand enthält keine Zeitkontodaten.' },
  unknownBalance: { en: 'Not available', de: 'Nicht verfügbar' },
  holiday: { en: 'Public holiday', de: 'Feiertag' },
  sickness: { en: 'Sickness', de: 'Krankheit' },
  compensation: { en: 'Time off in lieu', de: 'Freizeitausgleich' },
  uncovered: { en: 'Uncovered target', de: 'Ungedecktes Soll' },
  requestedCompensation: { en: 'Requested: {duration}', de: 'Beantragt: {duration}' },
  plannedDaily: { en: 'Planned absence', de: 'Geplante Abwesenheit' },
} satisfies Messages;
