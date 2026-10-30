import type { Messages } from '../i18n';

export const workflows = {
  "close": {
    "en": "Close",
    "de": "Schließen"
  },
  "cancel": {
    "en": "Cancel",
    "de": "Abbrechen"
  },
  "remove": {
    "en": "Remove",
    "de": "Entfernen"
  },
  "delete": {
    "en": "Delete",
    "de": "Löschen"
  },
  "edit": {
    "en": "Edit",
    "de": "Bearbeiten"
  },
  "note": {
    "en": "Note",
    "de": "Notiz"
  },
  "optional": {
    "en": "optional",
    "de": "optional"
  },
  "activity": {
    "en": "Activity",
    "de": "Tätigkeit"
  },
  "duration": {
    "en": "Duration",
    "de": "Dauer"
  },
  "newTemplate": {
    "en": "New template",
    "de": "Neue Vorlage"
  },
  "editTemplate": {
    "en": "Edit template",
    "de": "Vorlage bearbeiten"
  },
  "quickPick": {
    "en": "Quick selection",
    "de": "Schnellauswahl"
  },
  "templates": {
    "en": "Templates",
    "de": "Vorlagen"
  },
  "saveTemplate": {
    "en": "Save template",
    "de": "Vorlage speichern"
  },
  "savingTemplate": {
    "en": "Saving template …",
    "de": "Vorlage speichern …"
  },
  "saveTemplateFailed": {
    "en": "Could not save the template.",
    "de": "Vorlage konnte nicht gespeichert werden."
  },
  "deleteTemplateFailed": {
    "en": "Could not delete the template.",
    "de": "Vorlage konnte nicht gelöscht werden."
  },
  "templateSaved": {
    "en": "Template saved.",
    "de": "Vorlage gespeichert."
  },
  "templateDeleted": {
    "en": "Template deleted.",
    "de": "Vorlage gelöscht."
  },
  "withoutActivity": {
    "en": "No activity",
    "de": "Ohne Tätigkeit"
  },
  "entryWithoutActivity": {
    "en": "Entry without an activity",
    "de": "Eintrag ohne Tätigkeit"
  },
  "apply": {
    "en": "Apply",
    "de": "Übernehmen"
  },
  "backOverview": {
    "en": "Back to overview",
    "de": "Zurück zur Übersicht"
  },
  "backQuickPick": {
    "en": "Back to quick selection",
    "de": "Zurück zur Schnellauswahl"
  },
  "chooseSource": {
    "en": "Choose a source",
    "de": "Quelle wählen"
  },
  "recentEntries": {
    "en": "Recent entries",
    "de": "Letzte Einträge"
  },
  "searchActivity": {
    "en": "Search activity or note",
    "de": "Tätigkeit oder Notiz suchen"
  },
  "noTemplateMatch": {
    "en": "No matching template.",
    "de": "Keine passende Vorlage."
  },
  "noTemplates": {
    "en": "No templates yet. Create one or save a work block as a template.",
    "de": "Noch keine Vorlagen. Lege eine an oder speichere einen Arbeitsblock als Vorlage."
  },
  "noRecentMatch": {
    "en": "No matching recent entries.",
    "de": "Keine passenden neueren Einträge."
  },
  "noRecent": {
    "en": "No recent entries yet.",
    "de": "Noch keine neueren Einträge."
  },
  "legacyEntries": {
    "en": "Older entries – by work date",
    "de": "Ältere Einträge – nach Arbeitsdatum"
  },
  "firstReuseHint": {
    "en": "A quick selection appears here after you save your first work block.",
    "de": "Nach dem ersten gespeicherten Arbeitsblock erscheint hier eine Schnellauswahl."
  },
  "templateUndoWarning": {
    "en": "Template changes remove the last undo option for working time.",
    "de": "Vorlagenänderungen entfernen die letzte Rückgängig-Option für Arbeitszeit."
  },
  "templateSaveDeleteUndo": {
    "en": "Saving or deleting a template removes the last undo option for working time.",
    "de": "Das Speichern oder Löschen einer Vorlage entfernt die letzte Rückgängig-Option für Arbeitszeit."
  },
  "templatePending": {
    "en": "Updating the template. Please wait.",
    "de": "Vorlagenänderung läuft. Bitte kurz warten."
  },
  "templateDescription": {
    "en": "Templates contain an activity, duration and note. They do not record working time themselves.",
    "de": "Vorlagen enthalten Tätigkeit, Dauer und Notiz. Sie buchen selbst keine Arbeitszeit."
  },
  "templateChanged": {
    "en": "This template has changed. Your draft is unchanged. Reopen the template to see its current values.",
    "de": "Diese Vorlage wurde zwischenzeitlich geändert. Dein Entwurf bleibt unverändert. Für den aktuellen Stand die Vorlage erneut öffnen."
  },
  "templateDeletedDraft": {
    "en": "This template has been deleted. Your draft is unchanged.",
    "de": "Diese Vorlage wurde zwischenzeitlich gelöscht. Dein Entwurf bleibt unverändert."
  },
  "templateDeletedSaveNew": {
    "en": "This template has been deleted. Your entries are preserved; you can save them as a new template.",
    "de": "Diese Vorlage wurde inzwischen gelöscht. Deine Eingaben bleiben erhalten; du kannst sie als neue Vorlage speichern."
  },
  "confirmDiscardTemplate": {
    "en": "Discard unsaved template changes?",
    "de": "Ungespeicherte Vorlagenänderungen verwerfen?"
  },
  "confirmOverwriteTemplate": {
    "en": "This template has changed. Save your draft and replace the current values?",
    "de": "Diese Vorlage wurde zwischenzeitlich geändert. Deinen Entwurf speichern und die inzwischen gespeicherten Werte ersetzen?"
  },
  "templatesRecent": {
    "en": "Templates and recent entries",
    "de": "Vorlagen und letzte Einträge"
  },
  "durationMinutes": {
    "en": "Duration in minutes",
    "de": "Dauer in Minuten"
  },
  "reuseInstructions": {
    "en": "Choose an activity, check the times, then save. Selecting an entry alone does not record working time.",
    "de": "Eine Tätigkeit wählen, Zeiten prüfen, dann speichern. Die Auswahl allein bucht keine Arbeitszeit."
  },
  "blockMaxWeek": {
    "en": "A work block can span at most seven local calendar days.",
    "de": "Ein Arbeitsblock darf höchstens sieben lokale Kalendertage lang sein."
  },
  "blockWholeMinutes": {
    "en": "Please set the start and end to whole minutes.",
    "de": "Bitte Beginn und Ende auf volle Minuten setzen."
  },
  "blockEndAfterStart": {
    "en": "The end must be after the start. Change the end date when working past midnight.",
    "de": "Das Ende muss nach dem Beginn liegen. Bei Arbeit über Mitternacht das Enddatum ändern."
  },
  "confirmReplaceText": {
    "en": "Replace the activity and note with the selection?",
    "de": "Tätigkeit und Notiz durch die Auswahl ersetzen?"
  },
  "selectionApplied": {
    "en": "Selection applied. Not saved yet.",
    "de": "Auswahl übernommen. Noch nicht gespeichert."
  },
  "chooseValidTime": {
    "en": "Choose an unambiguous daylight-saving occurrence and enter valid times.",
    "de": "Bitte die Zeitumstellung eindeutig auswählen und gültige Uhrzeiten verwenden."
  },
  "templateNeedsActivity": {
    "en": "A template needs an activity.",
    "de": "Für eine Vorlage ist eine Tätigkeit nötig."
  },
  "saveBlockFailed": {
    "en": "Could not save working time.",
    "de": "Arbeitszeit konnte nicht gespeichert werden."
  },
  "deleteBlockFailed": {
    "en": "Could not delete working time.",
    "de": "Arbeitszeit konnte nicht gelöscht werden."
  },
  "templateSavedBlockUnsaved": {
    "en": "Template saved. The work block has not been saved yet.",
    "de": "Vorlage gespeichert. Der Arbeitsblock ist noch nicht gespeichert."
  },
  "editBlock": {
    "en": "Edit working time",
    "de": "Arbeitszeit bearbeiten"
  },
  "createBlock": {
    "en": "Record working time",
    "de": "Arbeitszeit eintragen"
  },
  "backWorkingTime": {
    "en": "Back to working time",
    "de": "Zurück zur Arbeitszeit"
  },
  "activityPlaceholder": {
    "en": "What did you work on?",
    "de": "Woran hast du gearbeitet?"
  },
  "startDate": {
    "en": "Start · date",
    "de": "Beginn · Datum"
  },
  "startTime": {
    "en": "Start · time",
    "de": "Beginn · Uhrzeit"
  },
  "endDate": {
    "en": "End · date",
    "de": "Ende · Datum"
  },
  "endTime": {
    "en": "End · time",
    "de": "Ende · Uhrzeit"
  },
  "start": {
    "en": "Start",
    "de": "Beginn"
  },
  "end": {
    "en": "End",
    "de": "Ende"
  },
  "inputZone": {
    "en": "Input time zone:",
    "de": "Eingabezeitzone:"
  },
  "applyTemplateDuration": {
    "en": "Apply template duration",
    "de": "Vorlagendauer übernehmen"
  },
  "breakHint": {
    "en": "Leave breaks as a gap between work blocks.",
    "de": "Pausen bleiben als Lücke zwischen zwei Arbeitsblöcken."
  },
  "present": {
    "en": "added",
    "de": "vorhanden"
  },
  "moreDetails": {
    "en": "More details",
    "de": "Weitere Details"
  },
  "templateOptions": {
    "en": "Template options",
    "de": "Vorlagenoptionen"
  },
  "rememberTemplateActive": {
    "en": "Save as template enabled",
    "de": "Als Vorlage merken aktiv"
  },
  "rememberTemplate": {
    "en": "Save as template",
    "de": "Als Vorlage merken"
  },
  "templateActivityHint": {
    "en": "Enter an activity for the template.",
    "de": "Für die Vorlage bitte eine Tätigkeit eintragen."
  },
  "blockAndTemplateAtomic": {
    "en": "Working time and the new template are saved and undone together.",
    "de": "Arbeitszeit und neue Vorlage werden gemeinsam gespeichert und gemeinsam rückgängig gemacht."
  },
  "onlyTemplate": {
    "en": "Save as template only",
    "de": "Nur als Vorlage speichern"
  },
  "onlyTemplateUndo": {
    "en": "“Save as template only” removes the existing undo option for working time.",
    "de": "„Nur als Vorlage speichern“ entfernt die bisherige Rückgängig-Option für Arbeitszeit."
  },
  "savingTemplateWait": {
    "en": "Saving the template. Please wait.",
    "de": "Die Vorlage wird gespeichert. Bitte kurz warten."
  },
  "savingBlock": {
    "en": "Saving working time …",
    "de": "Arbeitszeit speichern …"
  },
  "saveBlock": {
    "en": "Save working time",
    "de": "Arbeitszeit speichern"
  },
  "chooseOccurrence": {
    "en": "Choose an occurrence",
    "de": "Vorkommen auswählen"
  },
  "vacation": {
    "en": "Leave",
    "de": "Urlaub"
  },
  "vacationAction": {
    "en": "Leave action",
    "de": "Urlaubsaktion"
  },
  "book": {
    "en": "Add",
    "de": "Eintragen"
  },
  "from": {
    "en": "From",
    "de": "Von"
  },
  "through": {
    "en": "To (inclusive)",
    "de": "Bis einschließlich"
  },
  "fraction": {
    "en": "Day fraction",
    "de": "Tagesanteil"
  },
  "wholeDay": {
    "en": "Full day",
    "de": "Ganzer Tag"
  },
  "halfDay": {
    "en": "Half day",
    "de": "Halber Tag"
  },
  "oneDay": {
    "en": "1 day",
    "de": "1 Tag"
  },
  "halfDayShort": {
    "en": "½ day",
    "de": "½ Tag"
  },
  "reviewSelection": {
    "en": "Review selection",
    "de": "Auswahl prüfen"
  },
  "vacationHelp": {
    "en": "Leave credits a fraction of your daily target without creating a work block. Deselect public holidays yourself.",
    "de": "Urlaub schreibt einen Anteil deines Tagessolls gut. Es entsteht kein Arbeitszeitblock. Feiertage bitte selbst abwählen."
  },
  "rangeEnd": {
    "en": "The end must be on or after the start.",
    "de": "Das Ende muss am oder nach dem Beginn liegen."
  },
  "rangeMax": {
    "en": "Select no more than 366 calendar days.",
    "de": "Bitte höchstens 366 Kalendertage auswählen."
  },
  "rangeValid": {
    "en": "Enter valid start and end dates.",
    "de": "Bitte Beginn und Ende als gültiges Datum eingeben."
  },
  "confirmDiscardVacation": {
    "en": "Discard the unsaved leave selection?",
    "de": "Ungespeicherte Urlaubsauswahl verwerfen?"
  },
  "confirmVacationChanged": {
    "en": "Leave has changed since you opened this dialog. Apply your selection to the current values?",
    "de": "Urlaub wurde seit dem Öffnen geändert. Deine Auswahl jetzt auf den aktuellen Stand anwenden?"
  },
  "confirmVacationReplace": {
    "en": "Replace existing leave on the selected dates with the new day fraction?",
    "de": "Vorhandenen Urlaub für die ausgewählten Tage durch den neuen Tagesanteil ersetzen?"
  },
  "saveVacationFailed": {
    "en": "Could not save leave.",
    "de": "Urlaub konnte nicht gespeichert werden."
  },
  "vacationChanged": {
    "en": "Saved leave days have changed. Your selection is preserved; changes will be checked again before overwriting.",
    "de": "Die gespeicherten Urlaubstage wurden aktualisiert. Deine Auswahl bleibt erhalten; Änderungen werden vor dem Überschreiben nochmals geprüft."
  },
  "workAdditional": {
    "en": "Work counts in addition.",
    "de": "Arbeit zählt zusätzlich."
  },
  "noVacationChange": {
    "en": "No changes to saved leave days.",
    "de": "Keine Änderung an den gespeicherten Urlaubstagen."
  },
  "vacationUndo": {
    "en": "Changing leave replaces the existing undo option.",
    "de": "Die Urlaubsänderung ersetzt die bisherige Rückgängig-Möglichkeit."
  },
  "vacationPending": {
    "en": "Saving leave. Your selection is preserved if an error occurs.",
    "de": "Urlaub wird gespeichert. Bei einem Fehler bleibt deine Auswahl erhalten."
  },
  "removeVacation": {
    "en": "Remove leave",
    "de": "Urlaub entfernen"
  },
  "bookVacation": {
    "en": "Add leave",
    "de": "Urlaub eintragen"
  },
  "vacationAccount": {
    "en": "Leave account",
    "de": "Urlaubskonto"
  },
  "vacationYear": {
    "en": "Leave year",
    "de": "Urlaubsjahr"
  },
  "previousVacationYear": {
    "en": "Previous leave year",
    "de": "Vorheriges Urlaubsjahr"
  },
  "nextVacationYear": {
    "en": "Next leave year",
    "de": "Nächstes Urlaubsjahr"
  },
  "confirmDiscardAllowance": {
    "en": "Discard the unsaved leave allowance?",
    "de": "Ungespeicherten Urlaubsanspruch verwerfen?"
  },
  "confirmAllowanceChanged": {
    "en": "The leave allowance has changed since you opened it. Replace the current values with your draft?",
    "de": "Der Urlaubsanspruch wurde seit dem Öffnen geändert. Die aktuellen Werte durch deinen Entwurf ersetzen?"
  },
  "saveAllowanceFailed": {
    "en": "Could not save the leave allowance.",
    "de": "Urlaubsanspruch konnte nicht gespeichert werden."
  },
  "taken": {
    "en": "Taken to date",
    "de": "Genommen bis heute"
  },
  "planned": {
    "en": "Planned",
    "de": "Geplant"
  },
  "remaining": {
    "en": "Remaining after planned leave",
    "de": "Rest nach Planung"
  },
  "unknown": {
    "en": "Unknown",
    "de": "Unbekannt"
  },
  "allowanceUnknown": {
    "en": "Enter your annual allowance and carryover to calculate remaining leave. Without an allowance, the remainder is unknown.",
    "de": "Trage den Jahresanspruch und Übertrag ein, um den Resturlaub zu berechnen. Ohne Anspruch ist der Rest unbekannt."
  },
  "allowanceExceeded": {
    "en": "Your leave days exceed the allowance. Check the allowance and planned leave.",
    "de": "Die eingetragenen Urlaubstage übersteigen den Anspruch. Bitte Anspruch und Planung prüfen."
  },
  "annualAllowance": {
    "en": "Annual allowance in days",
    "de": "Jahresanspruch in Tagen"
  },
  "carryover": {
    "en": "Carryover in days",
    "de": "Übertrag in Tagen"
  },
  "notSet": {
    "en": "Not set",
    "de": "Nicht hinterlegt"
  },
  "allowanceHelp": {
    "en": "Half days are supported. A full leave day with a work target uses one day of allowance, regardless of the hours. Days without a target use no allowance.",
    "de": "Halbe Tage sind möglich. Ein ganzer Urlaubstag mit Arbeitssoll verbraucht einen Tag Anspruch, unabhängig von der Stundenzahl. Tage ohne Soll verbrauchen keinen Anspruch."
  },
  "allowanceUndo": {
    "en": "Saving removes the existing undo option. Unchanged values leave it available.",
    "de": "Nach dem Speichern ist die bisherige Rückgängig-Möglichkeit nicht mehr verfügbar. Unveränderte Werte verändern sie nicht."
  },
  "saveAllowance": {
    "en": "Save allowance",
    "de": "Anspruch speichern"
  },
  "allowanceSaved": {
    "en": "Allowance saved.",
    "de": "Anspruch gespeichert."
  },
  "allowancePending": {
    "en": "Saving the allowance. Your draft is preserved if an error occurs.",
    "de": "Anspruch wird gespeichert. Bei einem Fehler bleibt dein Entwurf erhalten."
  },
  "noVacationYear": {
    "en": "No leave days have been recorded for this year.",
    "de": "Für dieses Jahr sind keine Urlaubstage eingetragen."
  },
  "dayNote": {
    "en": "Daily note",
    "de": "Tagesnotiz"
  },
  "weekNote": {
    "en": "Weekly note",
    "de": "Wochennotiz"
  },
  "confirmDiscardChanges": {
    "en": "Discard unsaved changes?",
    "de": "Ungespeicherte Änderungen verwerfen?"
  },
  "saveNoteFailed": {
    "en": "Could not save the note.",
    "de": "Notiz konnte nicht gespeichert werden."
  },
  "noteHelp": {
    "en": "Space for thoughts and open questions. Notes do not change working time, balances or week closure. Apply changes with “Save note”.",
    "de": "Platz für Gedanken und offene Punkte. Notizen ändern weder Arbeitszeit, Saldo noch den Wochenabschluss. Änderungen erst mit „Notiz speichern“ übernehmen."
  },
  "notePlaceholder": {
    "en": "What would you like to note for this period?",
    "de": "Was möchtest du für diesen Zeitraum festhalten?"
  },
  "noteClear": {
    "en": "Clear and save to remove an existing note.",
    "de": "Leeren und speichern entfernt eine vorhandene Notiz."
  },
  "noteUndo": {
    "en": "After saving, the last working-time change can no longer be undone.",
    "de": "Nach dem Speichern kann die letzte Arbeitszeitänderung nicht mehr rückgängig gemacht werden."
  },
  "notePending": {
    "en": "Saving the note. Please wait; your draft is preserved if an error occurs.",
    "de": "Die Notiz wird gespeichert. Bitte kurz warten; bei einem Fehler bleibt dein Entwurf erhalten."
  },
  "saveNote": {
    "en": "Save note",
    "de": "Notiz speichern"
  },
  "closeWeek": {
    "en": "Close week",
    "de": "Woche abschließen"
  },
  "weekReview": {
    "en": "Closure review",
    "de": "Abschlussprüfung"
  },
  "weekReviewHelp": {
    "en": "Closing confirms this week’s balance. Review the warnings before closing.",
    "de": "Mit dem Abschluss wird der Saldo dieser Woche bestätigt. Bitte prüfe die Hinweise vor dem Abschließen."
  },
  "weekReviewLoading": {
    "en": "Loading week review …",
    "de": "Wochenprüfung wird geladen …"
  },
  "weekReload": {
    "en": "Reload review",
    "de": "Prüfung erneut laden"
  },
  "weekUpdated": {
    "en": "Current data loaded. Review and acknowledge the warnings again.",
    "de": "Aktuelle Daten geladen. Bitte prüfe die Hinweise erneut und bestätige sie."
  },
  "reviewDay": {
    "en": "Review day",
    "de": "Tag prüfen"
  },
  "weekClear": {
    "en": "No open warnings for this week.",
    "de": "Keine offenen Hinweise für diese Woche."
  },
  "warningsReviewed": {
    "en": "Warnings reviewed",
    "de": "Hinweise geprüft"
  },
  "confirmFullTarget": {
    "en": "I confirm closure with the full weekly target.",
    "de": "Ich bestätige den Abschluss mit dem vollen Wochensoll."
  },
  "weekPending": {
    "en": "Closing the week. Please wait.",
    "de": "Die Woche wird abgeschlossen. Bitte kurz warten."
  },
  "weekCloseFailed": {
    "en": "Could not close the week.",
    "de": "Woche konnte nicht abgeschlossen werden."
  },
  "weekLoadFailed": {
    "en": "Could not load the week review.",
    "de": "Die Wochenprüfung konnte nicht geladen werden."
  },
  "weekWrong": {
    "en": "The loaded review belongs to a different week. Reload the review.",
    "de": "Die geladene Prüfung gehört zu einer anderen Woche. Bitte erneut laden."
  },
  "weekCurrent": {
    "en": "The current week has not ended yet.",
    "de": "Die laufende Woche ist noch nicht vorbei."
  },
  "timeAccount": {
    "en": "Time account",
    "de": "Zeitkonto"
  },
  "timeAccountSubtitle": {
    "en": "Working time and leave at a glance.",
    "de": "Stunden und Urlaub im Überblick."
  },
  "accountView": {
    "en": "Account view",
    "de": "Kontoansicht"
  },
  "hoursAccount": {
    "en": "Hours account",
    "de": "Stundenkonto"
  },
  "periodReports": { "en": "Period reports", "de": "Auswertungen" },
  "period": {
    "en": "Period",
    "de": "Zeitraum"
  },
  "month": {
    "en": "Month",
    "de": "Monat"
  },
  "quarter": {
    "en": "Quarter",
    "de": "Quartal"
  },
  "year": {
    "en": "Year",
    "de": "Jahr"
  },
  "previousPeriod": {
    "en": "Previous period",
    "de": "Vorheriger Zeitraum"
  },
  "nextPeriod": {
    "en": "Next period",
    "de": "Nächster Zeitraum"
  },
  "timesheet": {
    "en": "Timesheet",
    "de": "Stundenzettel"
  },
  "confirmedAccount": {
    "en": "Confirmed hours account",
    "de": "Bestätigtes Stundenkonto"
  },
  "confirmedBalance": {
    "en": "Confirmed balance",
    "de": "Bestätigter Saldo"
  },
  "actual": {
    "en": "Actual",
    "de": "Ist"
  },
  "target": {
    "en": "Target",
    "de": "Soll"
  },
  "vacationCredit": {
    "en": "Leave credit",
    "de": "Urlaubsgutschrift"
  },
  "provisionalAccount": {
    "en": "Provisional hours account",
    "de": "Vorläufiges Stundenkonto"
  },
  "provisionalBalance": {
    "en": "Provisional balance",
    "de": "Vorläufiger Saldo"
  },
  "reportsExplanation": {
    "en": "Only explicitly closed weeks contribute to the confirmed balance. Weeks crossing period boundaries are allocated by day. Leave is a separate credit, rather than working time. Future leave-only weeks and untouched weeks do not create a provisional shortfall.",
    "de": "Nur bewusst abgeschlossene Wochen fließen in den bestätigten Saldo ein. Grenzwochen werden tagegenau diesem Zeitraum zugerechnet. Urlaub zählt als separate Gutschrift, nicht als Arbeitszeit. Noch nicht begonnene reine Urlaubswochen und unbearbeitete Wochen erzeugen keinen vorläufigen Fehlbetrag."
  },
  "templatesSubtitle": {
    "en": "Prepare recurring activities and use them again.",
    "de": "Wiederkehrende Tätigkeiten vorbereiten und erneut verwenden."
  },
  "backCalendar": {
    "en": "Back to calendar",
    "de": "Zum Kalender"
  },
  "closeDialog": {
    "en": "Close dialog",
    "de": "Dialog schließen"
  },
  "workDate": {
    "en": "Working time for",
    "de": "Arbeitszeit für"
  },
  "invalidTime": {
    "en": "{label}: invalid input.",
    "de": "{label}: ungültige Eingabe."
  },
  "missingTime": {
    "en": "{label}: this time does not exist because of a daylight-saving change.",
    "de": "{label}: Diese Uhrzeit existiert wegen der Zeitumstellung nicht."
  },
  "ambiguousTime": {
    "en": "{label} occurs twice",
    "de": "{label} liegt zweimal vor"
  },
  "firstOccurrence": {
    "en": "First occurrence ({offset})",
    "de": "Erstes Vorkommen ({offset})"
  },
  "secondOccurrence": {
    "en": "Second occurrence ({offset})",
    "de": "Zweites Vorkommen ({offset})"
  },
  "zoneChanged": {
    "en": "The app time zone is now {zone}. This draft remains in {inputZone}; check the times before saving.",
    "de": "Die App-Zeitzone ist jetzt {zone}. Diese begonnene Eingabe bleibt in {inputZone}; bitte Uhrzeiten vor dem Speichern prüfen."
  },
  "selectedDuration": {
    "en": "Selected duration: {duration}. Existing times are preserved.",
    "de": "Ausgewählte Dauer: {duration}. Die bisherigen Zeiten bleiben erhalten."
  },
  "selectedDurationStart": {
    "en": "Selected duration: {duration}. First set the start and, if necessary, the daylight-saving occurrence.",
    "de": "Ausgewählte Dauer: {duration}. Zuerst den Beginn und ggf. das Vorkommen bei der Zeitumstellung festlegen."
  },
  "deletingContinues": {
    "en": "Deletion continues after closing.",
    "de": "Die Löschung läuft auch nach dem Schließen weiter."
  },
  "savingContinues": {
    "en": "Saving continues after closing.",
    "de": "Die Speicherung läuft auch nach dem Schließen weiter."
  },
  "confirmDeleteTemplate": {
    "en": "Delete template “{title}”?",
    "de": "Vorlage „{title}“ löschen?"
  },
  "applyEntry": {
    "en": "Apply {title}",
    "de": "{title} übernehmen"
  },
  "editTemplateName": {
    "en": "Edit template {title}",
    "de": "Vorlage {title} bearbeiten"
  },
  "deleteTemplateName": {
    "en": "Delete template {title}",
    "de": "Vorlage {title} löschen"
  },
  "minutesRange": {
    "en": "1–{max} minutes",
    "de": "1–{max} Minuten"
  },
  "selectedCount": {
    "en": "{count} selected",
    "de": "{count} ausgewählt"
  },
  "skippedTarget": {
    "en": " · {count} without a target skipped",
    "de": " · {count} ohne Soll übersprungen"
  },
  "skippedVacation": {
    "en": " · {count} without leave",
    "de": " · {count} ohne Urlaub"
  },
  "previousVacation": {
    "en": " · previously {fraction}",
    "de": " · bisher {fraction}"
  },
  "noTarget": {
    "en": " · no work target",
    "de": " · ohne Arbeitssoll"
  },
  "noVacation": {
    "en": " · no saved leave",
    "de": " · kein Urlaub gespeichert"
  },
  "fractionDate": {
    "en": "Day fraction for {date}",
    "de": "Tagesanteil für {date}"
  },
  "workVacationComposition": {
    "en": "{work} work + {vacation} leave against a {target} target.",
    "de": "{work} Arbeit + {vacation} Urlaub bei {target} Soll."
  },
  "vacationSavedOne": {
    "en": "{count} day will be saved.",
    "de": "{count} Tag wird gespeichert."
  },
  "vacationSavedMany": {
    "en": "{count} days will be saved.",
    "de": "{count} Tage werden gespeichert."
  },
  "vacationRemovedOne": {
    "en": "{count} day will be removed.",
    "de": "{count} Tag wird entfernt."
  },
  "vacationRemovedMany": {
    "en": "{count} days will be removed.",
    "de": "{count} Tage werden entfernt."
  },
  "daysOne": {
    "en": "{count} day",
    "de": "{count} Tag"
  },
  "daysMany": {
    "en": "{count} days",
    "de": "{count} Tage"
  },
  "allowanceYear": {
    "en": "Leave allowance {year}",
    "de": "Urlaubsanspruch {year}"
  },
  "vacationDaysYear": {
    "en": "Leave days {year}",
    "de": "Urlaubstage {year}"
  },
  "allowanceExternal": {
    "en": "The saved allowance has changed. Your draft is preserved. Current values: {current}",
    "de": "Der gespeicherte Anspruch wurde aktualisiert. Dein Entwurf bleibt erhalten. Aktuell: {current}"
  },
  "allowanceCurrent": {
    "en": "{entitlement} allowance and {carryover} carryover.",
    "de": "{entitlement} Anspruch und {carryover} Übertrag."
  },
  "noAllowance": {
    "en": "no allowance set.",
    "de": "kein Anspruch hinterlegt."
  },
  "creditDuration": {
    "en": "{duration} credit",
    "de": "{duration} Gutschrift"
  },
  "editVacationDate": {
    "en": "Edit leave on {date}",
    "de": "Urlaub am {date} bearbeiten"
  },
  "currentWeekDetail": {
    "en": "Closing uses the full weekly target, including upcoming workdays. Missing time affects the confirmed balance.",
    "de": "Beim Abschluss zählt das volle Wochensoll, einschließlich der noch kommenden Arbeitstage. Fehlende Zeiten wirken sich auf den bestätigten Saldo aus."
  },
  "warningMissing": {
    "en": "Workday with a target but no recorded working time.",
    "de": "Soll-Arbeitstag ohne erfasste Arbeitszeit."
  },
  "warningLong": {
    "en": "More than twelve hours of working time recorded.",
    "de": "Mehr als zwölf Stunden Arbeitszeit erfasst."
  },
  "warningEvidenceOne": {
    "en": "{count} item of evidence outside recorded working time.",
    "de": "{count} Hinweis außerhalb erfasster Arbeitszeit."
  },
  "warningEvidenceMany": {
    "en": "{count} items of evidence outside recorded working time.",
    "de": "{count} Hinweise außerhalb erfasster Arbeitszeit."
  },
  "warningsOne": {
    "en": "{count} warning",
    "de": "{count} Hinweis"
  },
  "warningsMany": {
    "en": "{count} warnings",
    "de": "{count} Hinweise"
  },
  "closedWeekOne": {
    "en": "{count} closed week in this period",
    "de": "{count} abgeschlossene Woche im Zeitraum"
  },
  "closedWeekMany": {
    "en": "{count} closed weeks in this period",
    "de": "{count} abgeschlossene Wochen im Zeitraum"
  },
  "openWeekOne": {
    "en": "{count} open week",
    "de": "{count} offene Woche"
  },
  "openWeekMany": {
    "en": "{count} open weeks",
    "de": "{count} offene Wochen"
  },
  "showOpenWeeks": {
    "en": "Show open weeks ({count})",
    "de": "Offene Wochen anzeigen ({count})"
  }
} satisfies Messages;
