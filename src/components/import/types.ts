import type { DataSource, ImportAnalysis, ImportInput, ImportPreview, Source } from '../../../shared/types.js';

export type Step = 'input' | 'assign' | 'preview' | 'result';

export interface ImportFlowProps {
  busy: boolean;
  timezone: string;
  enabledSources: string[];
  dataSources: DataSource[];
  initialDataSourceId?: string;
  onClose: () => void;
  onBack?: () => void;
  onGuardChange?: (guard: (() => boolean) | null) => void;
  onAnalyze: (input: ImportInput) => Promise<ImportAnalysis>;
  onCreateSource: (type: Source, name: string) => Promise<string | null>;
  onPreview: (input: ImportInput) => Promise<ImportPreview>;
  onCommit: (input: ImportInput, revision: number) => Promise<void>;
  onOpenPeriod: (date: string) => void;
}
