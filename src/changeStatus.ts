import type { DiffScope, GitStatusFile } from './types';

export type ChangeDescriptor = {
  code: string;
  color: string;
  label: string;
};

const MODIFIED_DESCRIPTOR: ChangeDescriptor = {
  code: 'M',
  color: 'var(--status-warning)',
  label: 'Modified',
};

const CONFLICT_DESCRIPTOR: ChangeDescriptor = {
  code: '!',
  color: 'var(--status-error)',
  label: 'Conflicted',
};

const CHANGE_DESCRIPTORS = new Map<string, ChangeDescriptor>([
  ['?', { code: '?', color: 'var(--status-info)', label: 'Untracked' }],
  ['A', { code: 'A', color: 'var(--status-success)', label: 'Added' }],
  ['D', { code: 'D', color: 'var(--status-error)', label: 'Deleted' }],
  ['R', { code: 'R', color: 'var(--status-info)', label: 'Renamed' }],
  ['C', { code: 'C', color: 'var(--status-info)', label: 'Copied' }],
  ['M', MODIFIED_DESCRIPTOR],
]);

export const isConflictedStatusFile = (file: GitStatusFile): boolean => {
  const index = file.index?.trim() ?? '';
  const working = file.working_dir?.trim() ?? '';
  return (
    index === 'U' ||
    working === 'U' ||
    (index === 'A' && working === 'A') ||
    (index === 'D' && working === 'D')
  );
};

export const isNewStatusFile = (file: GitStatusFile, scope?: DiffScope): boolean => {
  const index = file.index?.trim() ?? '';
  const working = file.working_dir?.trim() ?? '';
  if (scope === 'staged') return index === 'A';
  if (scope === 'working') return index === '?' || working === '?' || working === 'A';
  return index === 'A' || working === 'A' || index === '?' || working === '?';
};

export const isStagedStatusFile = (file: GitStatusFile): boolean => {
  const indexCode = file.index?.trim();
  return Boolean(indexCode && indexCode !== '?');
};

export const isWorkingStatusFile = (file: GitStatusFile): boolean => {
  const workingCode = file.working_dir?.trim();
  return Boolean(workingCode) || file.index === '?';
};

const getChangeSymbol = (file: GitStatusFile, scope?: DiffScope): string => {
  const indexCode = file.index?.trim() ?? '';
  const workingCode = file.working_dir?.trim() ?? '';
  if (scope === 'staged' && indexCode && indexCode !== '?') return indexCode.charAt(0);
  if (scope === 'working' && workingCode) return workingCode.charAt(0);
  if (indexCode && indexCode !== '?') return indexCode.charAt(0);
  if (workingCode) return workingCode.charAt(0);
  return indexCode.charAt(0) || workingCode.charAt(0) || 'M';
};

export const describeChange = (file: GitStatusFile, scope?: DiffScope): ChangeDescriptor => {
  if (isConflictedStatusFile(file)) return CONFLICT_DESCRIPTOR;
  return CHANGE_DESCRIPTORS.get(getChangeSymbol(file, scope)) ?? MODIFIED_DESCRIPTOR;
};
