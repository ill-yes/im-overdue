import { translate, type MessageParams, type MessageProblem, type Messages } from './i18n.js';

export const serverMessages = {
  "error.account.minutes": { en: "Minutes must be a whole number between -1,000,000,000 and 1,000,000,000.", de: "Minuten müssen eine ganze Zahl zwischen -1.000.000.000 und 1.000.000.000 sein." },
  "error.account.zero": { en: "An account entry must have a non-zero duration.", de: "Eine Kontobuchung benötigt eine Dauer ungleich null." },
  "error.account.kind": { en: "Choose payout or correction; payouts require negative minutes.", de: "Auszahlung oder Korrektur wählen; Auszahlungen benötigen negative Minuten." },
  "error.account.reason": { en: "The reason must contain 1 to 500 characters.", de: "Die Begründung muss 1 bis 500 Zeichen enthalten." },
  "error.account.opening": { en: "Set an opening balance before adding entries, and use a date on or after it.", de: "Zuerst einen Anfangssaldo setzen und Buchungen frühestens ab diesem Datum erfassen." },
  "error.account.notFound": { en: "Account entry not found.", de: "Kontobuchung nicht gefunden." },
  "error.absence.days": { en: "Provide 1 to 366 unique absence dates within 366 calendar days.", de: "1 bis 366 eindeutige Abwesenheitstage innerhalb von 366 Kalendertagen angeben." },
  "error.absence.value": { en: "Invalid absence combination or compensation amount.", de: "Ungültige Abwesenheitskombination oder ungültiger Freizeitausgleich." },
  "error.absence.target": { en: "New absences require a positive daily target.", de: "Neue Abwesenheiten benötigen ein positives Tagessoll." },
  "error.holiday.region": { en: "Choose a German state or disable regional holidays.", de: "Ein deutsches Bundesland wählen oder regionale Feiertage deaktivieren." },
  "error.holiday.ruleVersion": { en: "Unsupported holiday rule version.", de: "Nicht unterstützte Version der Feiertagsregeln." },
  "error.holiday.name": { en: "The holiday name must contain 1 to 160 characters, or be null to exclude it.", de: "Der Feiertagsname muss 1 bis 160 Zeichen enthalten, oder null zum Ausschließen sein." },
  "error.holiday.notFound": { en: "Holiday profile not found.", de: "Feiertagsprofil nicht gefunden." },

  "error.auth.required": { en: "Please sign in.", de: "Bitte anmelden." },
  "error.auth.invalid": { en: "Incorrect password.", de: "Das Passwort ist nicht korrekt." },
  "error.auth.limited": { en: "Too many login attempts. Please try again later.", de: "Zu viele Anmeldeversuche. Bitte später erneut versuchen." },
  "error.auth.busy": { en: "A login is already being checked.", de: "Eine Anmeldung wird bereits geprüft." },
  "error.security.host": { en: "This host is not allowed.", de: "Dieser Host ist nicht erlaubt." },
  "error.security.site": { en: "Requests from another website are not allowed.", de: "Anfragen von fremden Websites sind nicht erlaubt." },
  "error.security.origin": { en: "The origin does not match the configured server address.", de: "Die Origin stimmt nicht mit der konfigurierten Serveradresse überein." },
  "error.http.jsonType": { en: "JSON content type is required.", de: "JSON-Content-Type erforderlich." },
  "error.http.jsonObject": { en: "A JSON object is required.", de: "JSON-Objekt erwartet." },
  "error.http.jsonInvalid": { en: "Invalid JSON.", de: "Ungültiges JSON." },
  "error.http.tooLarge": { en: "The request is too large.", de: "Die Anfrage ist zu groß." },
  "error.http.internal": { en: "Internal server error.", de: "Interner Serverfehler." },
  "error.http.notFound": { en: "API endpoint not found.", de: "API-Endpunkt nicht gefunden." },
  "error.validation.boolean": { en: "{field} must be a boolean.", de: "{field} muss ein Boolean sein." },
  "error.validation.offset": { en: "{field}: a UTC offset or Z is required.", de: "{field}: UTC-Offset oder Z erforderlich." },
  "error.validation.time": { en: "{field}: invalid time.", de: "{field}: ungültige Zeit." },
  "error.validation.minute": { en: "{field}: only whole minutes are allowed.", de: "{field}: nur volle Minuten erlaubt." },
  "error.validation.end": { en: "The end must be after the start.", de: "Das Ende muss nach dem Beginn liegen." },
  "error.validation.note": { en: "The note must be text with no more than {max} characters.", de: "Die Notiz muss Text mit maximal {max} Zeichen sein." },
  "error.validation.nameText": { en: "The name must be text.", de: "Der Name muss Text sein." },
  "error.validation.nameLength": { en: "The name must contain 1 to 160 characters.", de: "Der Name muss 1 bis 160 Zeichen enthalten." },
  "error.validation.duration": { en: "The duration must be 1 to {max} whole minutes.", de: "Die Dauer muss 1 bis {max} ganze Minuten betragen." },
  "error.validation.dateFormat": { en: "A date in YYYY-MM-DD format is required.", de: "Datum im Format YYYY-MM-DD erwartet." },
  "error.validation.date": { en: "Invalid date.", de: "Ungültiges Datum." },
  "error.validation.monday": { en: "Profiles and weeks must start on a Monday.", de: "Profil und Woche müssen an einem Montag beginnen." },
  "error.validation.timezone": { en: "Invalid time zone.", de: "Ungültige Zeitzone." },
  "error.validation.weeklyMinutes": { en: "weeklyMinutes must be between 0 and 10080.", de: "weeklyMinutes muss zwischen 0 und 10080 liegen." },
  "error.validation.workdays": { en: "workdays must contain unique weekdays from 1 to 7.", de: "workdays muss eindeutige Wochentage von 1 bis 7 enthalten." },
  "error.vacation.count": { en: "Between 1 and 366 leave days are required.", de: "1 bis 366 Urlaubstage erwartet." },
  "error.vacation.day": { en: "Invalid leave day.", de: "Ungültiger Urlaubstag." },
  "error.vacation.duplicate": { en: "Leave days must be unique.", de: "Urlaubstage müssen eindeutig sein." },
  "error.vacation.fraction": { en: "Leave must be a half or a whole day.", de: "Urlaub muss ein halber oder ganzer Tag sein." },
  "error.vacation.range": { en: "The leave range may cover at most 366 calendar days.", de: "Der Urlaubsbereich darf höchstens 366 Kalendertage umfassen." },
  "error.vacation.allowance": { en: "Leave allowance must be in half-day increments between 0 and 3650.", de: "Der Urlaubsanspruch muss in halben Tagen zwischen 0 und 3650 liegen." },
  "error.vacation.target": { en: "Leave is only available on days with a positive target.", de: "Urlaub ist nur an Tagen mit positivem Soll möglich." },
  "error.vacation.year": { en: "Invalid leave year.", de: "Ungültiges Urlaubsjahr." },
  "error.template.notFound": { en: "Template not found.", de: "Vorlage nicht gefunden." },
  "error.template.duplicate": { en: "This template already exists.", de: "Diese Vorlage existiert bereits." },
  "error.note.scope": { en: "The note scope must be day or week.", de: "Der Notizbereich muss day oder week sein." },
  "error.block.notFound": { en: "Work block not found.", de: "Arbeitsblock nicht gefunden." },
  "error.block.overlap": { en: "Work blocks must not overlap.", de: "Arbeitsblöcke dürfen sich nicht überschneiden." },
  "error.block.range": { en: "A work block may span at most seven local calendar days.", de: "Ein Arbeitsblock darf höchstens sieben lokale Kalendertage lang sein." },
  "error.undo.token": { en: "The undo token is missing.", de: "Der Undo-Token fehlt." },
  "error.undo.unavailable": { en: "Undo is no longer available.", de: "Rückgängig ist nicht mehr verfügbar." },
  "error.undo.changed": { en: "The saved state has changed.", de: "Der gespeicherte Stand hat sich geändert." },
  "error.revision.required": { en: "expectedRevision is required.", de: "expectedRevision fehlt." },
  "error.revision.conflict": { en: "This view is out of date. Please reload.", de: "Die Ansicht ist veraltet. Bitte neu laden." },
  "error.week.reopen": { en: "Closed weeks must be reopened.", de: "Abgeschlossene Wochen müssen wieder geöffnet werden." },
  "error.week.status": { en: "status must be open or closed.", de: "status muss open oder closed sein." },
  "error.week.reviewKey": { en: "reviewKey must be text with 1 to 20000 characters.", de: "reviewKey muss Text mit 1 bis 20000 Zeichen sein." },
  "error.week.reviewChanged": { en: "The week review has changed. Please review it again.", de: "Die Wochenprüfung hat sich geändert. Bitte erneut prüfen." },
  "error.week.future": { en: "Future weeks cannot be closed.", de: "Zukünftige Wochen können nicht abgeschlossen werden." },
  "error.week.current": { en: "Close the current week with its full target?", de: "Die laufende Woche mit vollem Soll abschließen?" },
  "error.week.warnings": { en: "Please confirm the warnings before closing the week.", de: "Bitte Hinweise vor dem Wochenabschluss bestätigen." },
  "error.timesheet.range": { en: "The export range must cover 1 to 366 calendar days.", de: "Der Exportbereich muss 1 bis 366 Kalendertage umfassen." },
  "error.import.input": { en: "format and text are required.", de: "format und text erforderlich." },
  "error.import.size": { en: "The import file is larger than 5 MB.", de: "Die Importdatei ist größer als 5 MB." },
  "error.import.timestampOffset": { en: "{field}: a timestamp with a UTC offset or Z is required.", de: "{field}: Zeitstempel mit UTC-Offset oder Z erforderlich." },
  "error.import.timestamp": { en: "{field}: invalid timestamp.", de: "{field}: ungültiger Zeitstempel." },
  "error.import.row": { en: "Each record must be an object.", de: "Jeder Datensatz muss ein Objekt sein." },
  "error.import.source": { en: "Unknown source.", de: "Unbekannte Quelle." },
  "error.import.id": { en: "The ID is missing or too long.", de: "Die ID fehlt oder ist zu lang." },
  "error.import.title": { en: "The title is missing or too long.", de: "Der Titel fehlt oder ist zu lang." },
  "error.import.end": { en: "end must be after start.", de: "end muss nach start liegen." },
  "error.import.urlLength": { en: "The URL is invalid or too long.", de: "Die URL ist ungültig oder zu lang." },
  "error.import.url": { en: "Only HTTP/HTTPS URLs are allowed.", de: "Nur HTTP/HTTPS-URLs sind erlaubt." },
  "error.import.jsonShape": { en: "JSON must contain schemaVersion 1 and an activities array.", de: "JSON benötigt schemaVersion 1 und ein activities-Array." },
  "error.import.csvHeader": { en: "The CSV header must contain exactly {fields}.", de: "Die CSV-Kopfzeile muss genau {fields} enthalten." },
  "error.import.csvMissingHeader": { en: "The CSV header is missing.", de: "Die CSV-Kopfzeile fehlt." },
  "error.import.format": { en: "The format must be json or csv.", de: "Das Format muss json oder csv sein." },
  "error.import.rows": { en: "An import may contain at most 20,000 records.", de: "Ein Import darf höchstens 20.000 Datensätze enthalten." },
  "error.import.duplicate": { en: "The file contains a conflicting duplicate key.", de: "Die Datei enthält einen widersprüchlichen doppelten Schlüssel." },
  "error.import.invalid": { en: "Invalid import format.", de: "Ungültiges Importformat." },
  "error.import.activity": { en: "Invalid activity.", de: "Ungültige Aktivität." },
  "error.import.commit": { en: "The import contains {count} errors. Please check the preview.", de: "Der Import enthält {count} Fehler. Bitte die Vorschau prüfen." },
  "error.import.assignmentsObject": { en: "assignments must be an object.", de: "assignments muss ein Objekt sein." },
  "error.import.assignments": { en: "Invalid import assignment.", de: "Ungültige Importzuordnung." },
  "error.import.fileName": { en: "The file name must contain 1 to 255 characters.", de: "Der Dateiname muss 1 bis 255 Zeichen enthalten." },
  "error.import.targetInvalid": { en: "Invalid import target for {source}.", de: "Ungültiges Importziel für {source}." },
  "error.import.targetMissing": { en: "The import target for {source} is missing, does not exist, or has a different type.", de: "Das Importziel für {source} fehlt, existiert nicht oder hat einen anderen Typ." },
  "error.import.targetAmbiguous": { en: "There are multiple data sources for {source}. Please choose an import target.", de: "Mehrere Datenquellen für {source}: Bitte ein Importziel wählen." },
  "error.dataSource.notFound": { en: "Data source not found.", de: "Datenquelle nicht gefunden." },
  "error.dataSource.type": { en: "Unknown source type.", de: "Unbekannter Quellentyp." },
  "error.dataSource.typeImmutable": { en: "The source type cannot be changed.", de: "Der Quellentyp ist unveränderlich." },
  "error.dataSource.query": { en: "Unknown query parameter.", de: "Unbekannter Abfrageparameter." },
  "error.dataSource.page": { en: "page must be a non-negative whole number.", de: "page muss eine nichtnegative ganze Zahl sein." },
  "error.dataSource.pageSize": { en: "page is too large.", de: "page ist zu groß." },
  "error.dataSource.search": { en: "q must be text with no more than 500 characters.", de: "q muss Text mit maximal 500 Zeichen sein." },
  "error.importPackage.notFound": { en: "Import package not found.", de: "Importpaket nicht gefunden." },
} as const satisfies Messages;

export type ServerMessageKey = keyof typeof serverMessages;

/** The legacy `message` field stays German for existing clients; it is derived from the catalog. */
export function legacyMessage(messageKey: ServerMessageKey, messageParams?: MessageParams): string {
  return translate(serverMessages, messageKey, messageParams, 'de');
}

/** A stable, language-independent descriptor plus the legacy German message. */
export function serverProblem(messageKey: ServerMessageKey, messageParams?: MessageParams): MessageProblem {
  return { message: legacyMessage(messageKey, messageParams), messageKey, ...(messageParams ? { messageParams } : {}) };
}

export class MessageError extends Error {
  constructor(public messageKey: ServerMessageKey, public messageParams?: MessageParams) { super(legacyMessage(messageKey, messageParams)); }
}

export function importProblem(error: unknown, fallback: 'error.import.invalid' | 'error.import.activity'): MessageProblem {
  if (error instanceof MessageError) return serverProblem(error.messageKey, error.messageParams);
  // Parser errors carry their own detail; anything else falls back to the catalog text.
  return error instanceof Error ? { message: error.message, messageKey: fallback } : serverProblem(fallback);
}
