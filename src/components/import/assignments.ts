import type { DataSource, ImportAnalysis, Source } from '../../../shared/types.js';

export type Assignments = Partial<Record<Source, string>>;

export function canSkipAssignments(
  analysis: ImportAnalysis,
  dataSources: DataSource[],
  initialDataSourceId?: string,
): boolean {
  return Boolean(initialDataSourceId && analysis.errors.length === 0 && analysis.sources.length === 1 &&
    dataSources.some((entry) => entry.id === initialDataSourceId && entry.type === analysis.sources[0].source));
}

export function initialAssignments(
  analysis: ImportAnalysis,
  dataSources: DataSource[],
  initialDataSourceId?: string,
): Assignments {
  const assignments: Assignments = {};
  for (const { source } of analysis.sources) {
    const candidates = dataSources.filter((entry) => entry.type === source);
    const preferred = candidates.find((entry) => entry.id === initialDataSourceId);
    if (preferred || candidates.length === 1) assignments[source] = (preferred ?? candidates[0]).id;
  }
  return assignments;
}

export function assignmentsComplete(
  analysis: ImportAnalysis,
  assignments: Assignments,
  dataSources: DataSource[],
): boolean {
  return analysis.sources.length > 0 && analysis.errors.length === 0 &&
    analysis.sources.every(({ source }) => dataSources.some(
      (entry) => entry.type === source && entry.id === assignments[source],
    ));
}
