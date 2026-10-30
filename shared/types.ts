import type { MessageProblem } from './i18n.js';

export const SOURCES = ['google_calendar', 'slack', 'github', 'other'] as const;
export type Source = (typeof SOURCES)[number];
export interface Activity {
  /** Persisted/API records always carry this; absent only in legacy model inputs. */
  dataSourceId?: string;
  source: Source;
  id: string;
  start: string;
  end: string | null;
  title: string;
  url: string | null;
}
export interface WorkBlock { id: string; start: string; end: string; note: string; title: string; createdAt: string | null }
export interface ReusableInput { title: string; note: string; durationMinutes: number }
export interface WorkTemplate extends ReusableInput { id: string }
export interface RecentEntry extends ReusableInput { id: string; createdAt: string }
export interface WorkProfile {
  id: string;
  effectiveFrom: string | null;
  weeklyMinutes: number;
  workdays: number[];
}
export interface WeekRecord { weekStart: string; status: 'open' | 'closed' }
export type NoteScope = 'day' | 'week';
export interface CalendarNote { scope: NoteScope; date: string; text: string }
export type VacationFraction = 0.5 | 1;
export interface VacationDay { date: string; fraction: VacationFraction }
export interface VacationChange { date: string; fraction: VacationFraction | null }
export interface VacationAllowance { year: number; entitlementDays: number; carryoverDays: number }
export interface AccountOpening { date: string; minutes: number }
export interface AccountEntry { id: string; date: string; kind: 'payout' | 'correction'; minutes: number; reason: string }
export type AccountEntryInput = Omit<AccountEntry, 'id'>;
export type CompensationAmount = { mode: 'fraction'; value: VacationFraction } | { mode: 'minutes'; value: number };
export interface AbsenceDay { date: string; sickness: boolean; compensation: CompensationAmount | null }
export interface AbsenceChange extends AbsenceDay { vacationFraction: VacationFraction | 0 }
export const GERMAN_STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'] as const;
export type GermanState = (typeof GERMAN_STATES)[number];
export interface HolidayProfile { id: string; effectiveFrom: string; region: GermanState | null; ruleVersion: 1 }
/** A null name explicitly excludes a regional holiday on this date. */
export interface HolidayOverride { date: string; name: string | null }
export interface ResolvedHoliday { date: string; name: string; nameEn: string; source: 'manual' | 'regional' }
export interface Settings { timezone: string }
export interface AppState {
  dataSources: DataSource[];
  revision: number;
  undo: { token: string; label: string } | null;
  settings: Settings;
  profiles: WorkProfile[];
  activities: Activity[];
  blocks: WorkBlock[];
  templates: WorkTemplate[];
  recentEntries: RecentEntry[];
  weeks: WeekRecord[];
  notes: CalendarNote[];
  vacations: VacationDay[];
  vacationAllowances: VacationAllowance[];
  /** Optional only for older snapshots/model inputs; the current API always includes these fields. */
  accountOpening?: AccountOpening | null;
  accountEntries?: AccountEntry[];
  absences?: AbsenceDay[];
  holidayProfiles?: HolidayProfile[];
  holidayOverrides?: HolidayOverride[];
}
export interface BlockInput { start: string; end: string; note: string; title?: string; rememberTemplate?: boolean }
export interface MutationGuard { expectedRevision: number; confirmReopen?: boolean }
export interface ApiProblem extends MessageProblem { code?: string; weeks?: string[]; review?: WeekReview }
export interface DataSource {
  id: string;
  type: Source;
  name: string;
  activityCount: number;
  packageCount: number;
  lastImportedAt: string | null;
  firstActivityStart: string | null;
  legacyCount: number;
}
export interface ImportInput {
  format: 'json' | 'csv'; text: string;
  assignments?: Partial<Record<Source, string>>;
  fileName?: string;
}
export interface ImportCounts { total: number; new: number; updated: number; unchanged: number; duplicates: number }
export interface ImportAnalysis {
  sources: { source: Source; count: number }[];
  total: number;
  duplicates: number;
  errors: (MessageProblem & { row?: number })[];
}
export interface ImportPackage {
  id: string; dataSourceId: string; fileName: string; createdAt: string;
  firstStart: string; lastEnd: string; counts: ImportCounts;
}
export interface DataPage<T> { items: T[]; total: number; page: number; pageSize: number }
export interface ImportPackagePage extends DataPage<Activity> { package: ImportPackage }
export interface ImportPreview {
  revision: number;
  counts: ImportCounts;
  rows: { activity: Activity; status: 'new' | 'updated' | 'unchanged'; previous?: Activity }[];
  errors: (MessageProblem & { row?: number })[];
}
export interface DayTotals { actualMinutes: number; vacationMinutes: number; targetMinutes: number; balanceMinutes: number }
export interface DayAccounting extends DayTotals {
  holiday: ResolvedHoliday | null;
  holidayMinutes: number;
  sicknessMinutes: number;
  compensationRequestedMinutes: number;
  compensationMinutes: number;
  uncoveredMinutes: number;
  vacationFraction: VacationFraction | 0;
}
export interface AccountSummary {
  opening: AccountOpening | null;
  asOf: string;
  confirmedMinutes: number | null;
  closedMinutes: number;
  entryMinutes: number;
  provisionalMinutes: number;
  plannedCompensationMinutes: number;
  plannedEntryMinutes: number;
  excludedEntries: AccountEntry[];
}
export interface AccountMovement { date: string; kind: 'opening' | 'work' | 'payout' | 'correction'; minutes: number; reason: string }
export interface AccountPeriod {
  opening: AccountOpening | null;
  from: string;
  to: string;
  asOf: string;
  startMinutes: number | null;
  endMinutes: number | null;
  provisionalMinutes: number;
  plannedCompensationMinutes: number;
  plannedEntryMinutes: number;
  movements: AccountMovement[];
}
export interface PeriodPart extends DayTotals { days: number; weeks: string[] }
export interface PeriodSummary { confirmed: PeriodPart; provisional: PeriodPart }

export interface WeekReviewWarning {
  date: string;
  kind: 'missing' | 'evidence' | 'long';
  message: string;
  count?: number;
}
export interface WeekReview {
  weekStart: string;
  revision: number;
  today: string;
  warnings: WeekReviewWarning[];
  requiresCurrentConfirmation: boolean;
}
export interface VacationAccount {
  year: number;
  allowance: VacationAllowance | null;
  takenDays: number;
  plannedDays: number;
  remainingDays: number | null;
}
export interface TimesheetBlock { start: string; end: string; title: string; note: string; minutes: number }
export interface TimesheetDay {
  date: string;
  status: 'untouched' | 'open' | 'closed';
  blocks: TimesheetBlock[];
  totals: DayTotals;
  vacationFraction: VacationFraction | 0;
  dayNote: string;
  weekNote: string;
  accounting?: DayAccounting;
}
export interface TimesheetSnapshot {
  revision: number;
  timezone: string;
  createdAt: string;
  from: string;
  to: string;
  days: TimesheetDay[];
  summary: PeriodSummary;
  account?: AccountPeriod;
}
export interface TimesheetOptions {
  includeTitles: boolean;
  includeBlockNotes: boolean;
  includeDayNotes: boolean;
  includeWeekNotes: boolean;
  closedOnly: boolean;
  name: string;
  includeAccount?: boolean;
}
