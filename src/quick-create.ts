import type { BlockInput } from '../shared/types.js';

export interface QuickCreateAnchor {
  date: string;
  lane: HTMLElement;
  minute: number;
}

export interface QuickCreateDraft {
  id: number;
  input: BlockInput;
  zone: string;
  anchor: QuickCreateAnchor;
}
