import { translate, type Language, type Messages } from '../../shared/i18n.js';

export const shellMessages = {
  "unreachable": {
    "en": "The app is unavailable.",
    "de": "Die App ist nicht erreichbar."
  },
  "sessionExpired": {
    "en": "Your session has expired. Please sign in again.",
    "de": "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an."
  },
  "loginFailedRetry": {
    "en": "Sign-in failed. Please try again.",
    "de": "Anmeldung fehlgeschlagen. Bitte erneut versuchen."
  },
  "loginFailed": {
    "en": "Sign-in failed.",
    "de": "Anmeldung fehlgeschlagen."
  },
  "logoutFailed": {
    "en": "Sign-out could not be confirmed. Check your connection and try signing out again.",
    "de": "Die Abmeldung konnte nicht bestätigt werden. Bitte die Verbindung prüfen und erneut abmelden."
  },
  "finishLogout": {
    "en": "Complete sign-out",
    "de": "Abmeldung abschließen"
  },
  "yourAccount": {
    "en": "Your time account.",
    "de": "Dein Zeitkonto."
  },
  "loginDescription": {
    "en": "Sign in to open your time account.",
    "de": "Melde dich an, um deine Zeiten zu öffnen."
  },
  "password": {
    "en": "Password",
    "de": "Passwort"
  },
  "signingIn": {
    "en": "Signing in …",
    "de": "Anmelden …"
  },
  "signIn": {
    "en": "Sign in",
    "de": "Anmelden"
  },
  "signingOut": {
    "en": "Signing out …",
    "de": "Abmelden …"
  },
  "checkingConnection": {
    "en": "Checking connection …",
    "de": "Verbindung wird geprüft …"
  },
  "retryLogout": {
    "en": "Try signing out again",
    "de": "Erneut abmelden"
  },
  "reconnect": {
    "en": "Reconnect",
    "de": "Erneut verbinden"
  },
  "brandCalendar": {
    "en": "I'm Overdue · Calendar",
    "de": "I'm Overdue · Kalender"
  },
  "navigation": {
    "en": "Main navigation",
    "de": "Hauptnavigation"
  },
  "calendar": {
    "en": "Calendar",
    "de": "Kalender"
  },
  "account": {
    "en": "Time account",
    "de": "Zeitkonto"
  },
  "templates": {
    "en": "Templates",
    "de": "Vorlagen"
  },
  "localStorage": {
    "en": "Stored locally",
    "de": "Lokal gespeichert"
  },
  "import": {
    "en": "Import",
    "de": "Importieren"
  },
  "settings": {
    "en": "Settings",
    "de": "Einstellungen"
  },
  "signOut": {
    "en": "Sign out",
    "de": "Abmelden"
  },
  "appActions": {
    "en": "App actions",
    "de": "App-Aktionen"
  },
  "loadFailed": {
    "en": "Data could not be loaded.",
    "de": "Daten konnten nicht geladen werden."
  },
  "reopenWeeks": {
    "en": "This change reopens the closed weeks {weeks}. Their balances remain provisional until you close them again. Continue?",
    "de": "Diese Änderung öffnet die abgeschlossenen Wochen {weeks} wieder. Ihre Salden gelten dann vorläufig, bis du sie erneut abschließt. Fortfahren?"
  },
  "reopenAffected": {
    "en": "This change reopens affected closed weeks. Their balances remain provisional until you close them again. Continue?",
    "de": "Diese Änderung öffnet betroffene abgeschlossene Wochen wieder. Ihre Salden gelten dann vorläufig, bis du sie erneut abschließt. Fortfahren?"
  },
  "closeCurrent": {
    "en": "The current week will be closed with its full weekly target, even if some days are still ahead. Close this week?",
    "de": "Die laufende Woche wird mit dem vollen Wochensoll abgeschlossen, auch wenn noch Tage bevorstehen. Wirklich abschließen?"
  },
  "reviewChanged": {
    "en": "The closing review has changed. Please check the latest warnings again.",
    "de": "Die Abschlussprüfung hat sich geändert. Bitte die aktuellen Hinweise erneut prüfen."
  },
  "undoConflict": {
    "en": "This change can no longer be undone. The latest data has been loaded; nothing was overwritten.",
    "de": "Diese Änderung kann nicht mehr rückgängig gemacht werden. Der aktuelle Stand wurde geladen; es wurde nichts überschrieben."
  },
  "revisionConflict": {
    "en": "The data has changed. The latest data has been loaded; please check your input again.",
    "de": "Die Daten haben sich zwischenzeitlich geändert. Der aktuelle Stand wurde geladen; bitte deine Eingabe erneut prüfen."
  },
  "overwriteChangedBlock": {
    "en": "This work block has changed since you opened it. Saving will replace its current times, activity and note with your entries. Overwrite these changes?",
    "de": "Dieser Arbeitsblock wurde seit dem Öffnen geändert. Beim Speichern ersetzt du seine aktuellen Zeiten, Tätigkeit und Notiz durch deine Eingaben. Änderungen überschreiben?"
  },
  "changeFailed": {
    "en": "Change failed.",
    "de": "Änderung fehlgeschlagen."
  },
  "waitRequest": {
    "en": "Please wait until the current request has finished.",
    "de": "Bitte warte, bis die laufende Anfrage abgeschlossen ist."
  },
  "imported": {
    "en": "Activities imported.",
    "de": "Aktivitäten importiert."
  },
  "timeSaved": {
    "en": "Working time saved.",
    "de": "Arbeitszeit gespeichert."
  },
  "timeUpdated": {
    "en": "Working time updated.",
    "de": "Arbeitszeit aktualisiert."
  },
  "timeSavedTemplate": {
    "en": "Working time saved and template remembered.",
    "de": "Arbeitszeit gespeichert und Vorlage gemerkt."
  },
  "timeUpdatedTemplate": {
    "en": "Working time updated and template remembered.",
    "de": "Arbeitszeit aktualisiert und Vorlage gemerkt."
  },
  "deleteBlockConfirm": {
    "en": "Delete this work block? You can undo the last working-time change afterwards.",
    "de": "Diesen Arbeitsblock löschen? Du kannst die letzte Arbeitszeitänderung anschließend rückgängig machen."
  },
  "timeDeleted": {
    "en": "Working time deleted.",
    "de": "Arbeitszeit gelöscht."
  },
  "weekReopened": {
    "en": "Week reopened.",
    "de": "Woche wieder geöffnet."
  },
  "weekClosed": {
    "en": "Week closed.",
    "de": "Woche abgeschlossen."
  },
  "vacationSaved": {
    "en": "Leave saved.",
    "de": "Urlaub gespeichert."
  },
  "allowanceSaved": {
    "en": "Leave allowance saved.",
    "de": "Urlaubsanspruch gespeichert."
  },
  "templateSaved": {
    "en": "Template saved. No working time recorded.",
    "de": "Vorlage gespeichert. Keine Arbeitszeit gebucht."
  },
  "templateDeleted": {
    "en": "Template deleted. Working time is unchanged.",
    "de": "Vorlage gelöscht. Arbeitszeiten bleiben erhalten."
  },
  sourceCreated: { en: 'Data source created.', de: 'Datenquelle angelegt.' },
  sourceRenamed: { en: 'Data source renamed.', de: 'Datenquelle umbenannt.' },
  sourceDeleted: { en: 'Data source, associated evidence and import packages deleted. Working times are unchanged.', de: 'Datenquelle und zugehörige Belege und Importpakete gelöscht. Arbeitszeiten bleiben erhalten.' },
  "noteOverwrite": {
    "en": "This note has changed. Save your draft and replace the text that was saved in the meantime?",
    "de": "Diese Notiz wurde zwischenzeitlich geändert. Deinen Entwurf speichern und den inzwischen gespeicherten Text ersetzen?"
  },
  "dayNoteSaved": {
    "en": "Day note saved.",
    "de": "Tagesnotiz gespeichert."
  },
  "dayNoteRemoved": {
    "en": "Day note removed.",
    "de": "Tagesnotiz entfernt."
  },
  "weekNoteSaved": {
    "en": "Week note saved.",
    "de": "Wochennotiz gespeichert."
  },
  "weekNoteRemoved": {
    "en": "Week note removed.",
    "de": "Wochennotiz entfernt."
  },
  "hideError": {
    "en": "Dismiss error",
    "de": "Fehler ausblenden"
  },
  "loading": {
    "en": "Loading local data …",
    "de": "Lokale Daten werden geladen …"
  },
  "localLoadFailed": {
    "en": "The local data could not be loaded.",
    "de": "Die lokalen Daten konnten nicht geladen werden."
  },
  "retry": {
    "en": "Try again",
    "de": "Erneut versuchen"
  },
  "zoneSaved": {
    "en": "Time zone saved.",
    "de": "Zeitzone gespeichert."
  },
  "profileSaved": {
    "en": "Target profile saved.",
    "de": "Sollprofil gespeichert."
  },
  "undoTime": {
    "en": "Working-time change undone.",
    "de": "Arbeitszeitänderung rückgängig gemacht."
  },
  "undoVacation": {
    "en": "Leave change undone.",
    "de": "Urlaubsänderung rückgängig gemacht."
  },
  "undoTemplate": {
    "en": " The template remembered with this change was also removed.",
    "de": " Die dabei neu gemerkte Vorlage wurde ebenfalls zurückgenommen."
  },
  "undoWeeks": {
    "en": " Closed again: {weeks}.",
    "de": " Wieder abgeschlossen: {weeks}."
  },
  "backupFailed": {
    "en": "The backup could not be downloaded.",
    "de": "Das Backup konnte nicht geladen werden."
  },
  "invalidHours": {
    "en": "Enter valid weekly hours and select at least one working day.",
    "de": "Bitte gültige Wochenstunden und mindestens einen Arbeitstag wählen."
  },
  "mondayRequired": {
    "en": "The effective date must be a Monday.",
    "de": "Das Gültigkeitsdatum muss ein Montag sein."
  },
  "profileHistoryConfirm": {
    "en": "This target profile changes the balance of recorded or closed weeks retrospectively. Affected weeks must be reviewed and, if needed, closed again. Continue?",
    "de": "Dieses Sollprofil ändert rückwirkend die Bilanz erfasster oder abgeschlossener Wochen. Betroffene Wochen müssen anschließend erneut geprüft und gegebenenfalls abgeschlossen werden. Fortfahren?"
  },
  "profileFailed": {
    "en": "The target profile could not be saved.",
    "de": "Sollprofil konnte nicht gespeichert werden."
  },
  "invalidZone": {
    "en": "Enter a valid IANA time zone, for example Europe/Berlin.",
    "de": "Bitte eine gültige IANA-Zeitzone eingeben, zum Beispiel Europe/Berlin."
  },
  "zoneFailed": {
    "en": "The time zone could not be saved.",
    "de": "Zeitzone konnte nicht gespeichert werden."
  },
  "zone": {
    "en": "Time zone",
    "de": "Zeitzone"
  },
  "zoneDescription": {
    "en": "Determines the local day that working time and activities belong to.",
    "de": "Bestimmt, welchem lokalen Tag Arbeitszeiten und Aktivitäten zugeordnet werden."
  },
  "searchZone": {
    "en": "Find a time zone",
    "de": "Zeitzone suchen"
  },
  "saving": {
    "en": "Saving …",
    "de": "Speichern …"
  },
  "save": {
    "en": "Save",
    "de": "Speichern"
  },
  "weeklyTarget": {
    "en": "Weekly target",
    "de": "Wöchentliches Soll"
  },
  "currentProfile": {
    "en": "Current target profile",
    "de": "Aktuell gültiges Sollprofil"
  },
  "current": {
    "en": "Currently active",
    "de": "Aktuell gültig"
  },
  "perWeek": {
    "en": "{hours} per week",
    "de": "{hours} pro Woche"
  },
  "since": {
    "en": "Since {date}",
    "de": "Seit {date}"
  },
  "sinceBeginning": {
    "en": "Since records began",
    "de": "Seit Beginn der Aufzeichnung"
  },
  "targetDescription": {
    "en": "The target is distributed evenly across the selected working days.",
    "de": "Das Soll wird gleichmäßig auf die gewählten Arbeitstage verteilt."
  },
  "changeTarget": {
    "en": "Change target",
    "de": "Soll ändern"
  },
  "futureTarget": {
    "en": "Change working hours from …",
    "de": "Arbeitszeit ab … ändern"
  },
  "pastTarget": {
    "en": "Correct past targets",
    "de": "Vergangenes Soll korrigieren"
  },
  "historyWarning": {
    "en": "You are editing the base profile for existing records. Changes to past targets reopen affected closed weeks.",
    "de": "Du bearbeitest das Grundprofil für die bisherige Historie. Änderungen an vergangenem Soll öffnen betroffene abgeschlossene Wochen wieder."
  },
  "weeklyHours": {
    "en": "Hours per week",
    "de": "Stunden pro Woche"
  },
  "validMonday": {
    "en": "Effective from Monday",
    "de": "Gültig ab Montag"
  },
  "workingDays": {
    "en": "Working days",
    "de": "Arbeitstage"
  },
  "saveProfile": {
    "en": "Save target profile",
    "de": "Sollprofil speichern"
  },
  "profileHistory": {
    "en": "Profile history",
    "de": "Profilverlauf"
  },
  "from": {
    "en": "From {date}",
    "de": "Ab {date}"
  },
  "baseProfile": {
    "en": "Base profile · all records",
    "de": "Grundprofil · gesamte Historie"
  },
  "backup": {
    "en": "Backup",
    "de": "Datensicherung"
  },
  "backupDescription": {
    "en": "Download a consistent copy of the local database. To restore it, stop the app and replace the database file as described in the README.",
    "de": "Lade eine konsistente Kopie der lokalen Datenbank herunter. Zur Wiederherstellung die App stoppen und die Datenbankdatei gemäß README ersetzen."
  },
  "backupLoading": {
    "en": "Downloading backup …",
    "de": "Backup wird geladen …"
  },
  "backupDownload": {
    "en": "Download SQLite backup",
    "de": "SQLite-Backup herunterladen"
  },
  "close": {
    "en": "Close",
    "de": "Schließen"
  },
  "language": {
    "en": "Language",
    "de": "Sprache"
  },
  "languageDescription": {
    "en": "Applies to this browser only. Your data and time zone stay unchanged.",
    "de": "Gilt nur für diesen Browser. Deine Daten und Zeitzone bleiben unverändert."
  },
  "undoAdded": {
    "en": "Working time added",
    "de": "Arbeitszeit hinzugefügt"
  },
  "undoChanged": {
    "en": "Working time changed",
    "de": "Arbeitszeit geändert"
  },
  "undoDeleted": {
    "en": "Working time deleted",
    "de": "Arbeitszeit gelöscht"
  },
  "undoLeaveRemoved": {
    "en": "Leave removed",
    "de": "Urlaub entfernt"
  },
  "undoLeaveAdded": {
    "en": "Leave entered",
    "de": "Urlaub eingetragen"
  },
  "undoLeaveChanged": {
    "en": "Leave changed",
    "de": "Urlaub geändert"
  }
} satisfies Messages;

const undoKeys = {
  'Arbeitszeit hinzugefügt': 'undoAdded',
  'Arbeitszeit geändert': 'undoChanged',
  'Arbeitszeit gelöscht': 'undoDeleted',
  'Urlaub entfernt': 'undoLeaveRemoved',
  'Urlaub eingetragen': 'undoLeaveAdded',
  'Urlaub geändert': 'undoLeaveChanged',
} as const;
export function undoLabel(label: string, language: Language): string {
  const key = undoKeys[label as keyof typeof undoKeys];
  return key ? translate(shellMessages, key, {}, language) : label;
}
export function undoIsVacation(label: string): boolean {
  return label === 'Urlaub entfernt' || label === 'Urlaub eingetragen' || label === 'Urlaub geändert';
}
