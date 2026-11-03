import type { FileDiffMetadata } from '@pierre/diffs';

export type DiffScope = 'working' | 'staged' | 'branch' | 'commit';

export type DiffViewMode = 'side-by-side' | 'unified';

export interface GitStatusFile {
  path: string;
  previousPath?: string;
  index: string;
  working_dir: string;
}

export interface GitFileStats {
  insertions: number;
  deletions: number;
}

export interface GitBranchesInfo {
  all: string[];
  defaultBranches: Record<string, string>;
  remotes: string[];
  primaryRemote: string | null;
}

export interface GitStatusResponse {
  isGitRepo: boolean;
  repoRoot: string | null;
  current: string | null;
  files: GitStatusFile[];
  diffStats: {
    staged: Record<string, GitFileStats>;
    working: Record<string, GitFileStats>;
  };
  branches: GitBranchesInfo;
  createdFromBase: string | null;
  difftAvailable: boolean;
  difftVersion: string | null;
}

export interface GitRangeFile {
  path: string;
  previousPath?: string;
  status: string;
  insertions: number;
  deletions: number;
  revision?: string;
}

export interface GitLogEntry {
  hash: string;
  parents: string[];
  author_name: string;
  author_email: string;
  date: string;
  message: string;
  files: number;
  insertions: number;
  deletions: number;
}

export interface GitCommitFile {
  path: string;
  previousPath?: string;
  status: string;
  insertions: number;
  deletions: number;
  isBinary: boolean;
}

export interface DifftChangeToken {
  start: number;
  end: number;
  content: string;
  highlight: string;
}

export interface DifftSide {
  line_number: number;
  changes: DifftChangeToken[];
}

export interface DifftChunkEntry {
  lhs?: DifftSide;
  rhs?: DifftSide;
}

export interface DifftJsonFile {
  path: string;
  language: string;
  status: 'changed' | 'unchanged' | 'created' | 'deleted';
  aligned_lines?: Array<[number | null, number | null]>;
  chunks?: Array<DifftChunkEntry[]>;
}

export interface ServiceFileDiffResponse {
  path: string;
  previousPath?: string;
  original: string;
  modified: string;
  isBinary: boolean;
  isImage: boolean;
  difft: DifftJsonFile | null;
  difftError?: string;
}

export interface FileEntry {
  path: string;
  previousPath?: string;
  index: string;
  working_dir: string;
  insertions: number;
  deletions: number;
  isNew: boolean;
  revision?: string;
}

export interface DifftLineSpan {
  spanStart: number;
  spanLength: number;
  highlight: string;
  content: string;
}

export interface DifftFileDecorations {
  language: string;
  status: 'changed' | 'unchanged' | 'created' | 'deleted';
  deletionSpans: ReadonlyMap<number, readonly DifftLineSpan[]>;
  additionSpans: ReadonlyMap<number, readonly DifftLineSpan[]>;
  structuralAdditions: number;
  structuralDeletions: number;
}

export type DiffContextMode = 'patch' | 'full';

export interface DiffData {
  original: string;
  modified: string;
  isBinary?: boolean;
  isImage?: boolean;
  fileDiff?: FileDiffMetadata;
  fallbackFileDiff?: FileDiffMetadata;
  difftDecorations?: DifftFileDecorations;
  contextMode: DiffContextMode;
  difftError?: string;
}
