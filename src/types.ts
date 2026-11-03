import type { FileDiffMetadata } from '@pierre/diffs';

export type DiffScope = 'working' | 'staged' | 'branch' | 'commit' | 'pr';

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

export interface GitSubmoduleState {
  headCommit: string | null;
  indexCommit: string | null;
  worktreeCommit: string | null;
  hasTrackedChanges: boolean;
  hasUntrackedFiles: boolean;
  hasConflict: boolean;
}

export type GitPathUnavailableReason =
  | 'path_not_found'
  | 'nested_repository'
  | 'untracked_directory';

export interface GitStatusResponse {
  isGitRepo: boolean;
  unborn?: boolean;
  repoRoot: string | null;
  homeDirectory?: string | null;
  current: string | null;
  files: GitStatusFile[];
  diffStats: {
    staged: Record<string, GitFileStats>;
    working: Record<string, GitFileStats>;
  };
  branches: GitBranchesInfo;
  createdFromBase: string | null;
  openPrBase?: string | null;
  difftAvailable: boolean;
  difftVersion: string | null;
}

export interface GitDirectoriesResponse {
  path: string;
  homeDirectory: string | null;
  repositories: Array<{ path: string; name: string }>;
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

export interface GitPullRequestEntry {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  baseRefOid?: string;
  author: string;
  url: string;
}

export interface GitPullRequestFile {
  path: string;
  previousPath?: string;
  status: string;
  insertions: number;
  deletions: number;
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
  submodule?: GitSubmoduleState | null;
  unavailableReason?: GitPathUnavailableReason;
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
  submodule?: GitSubmoduleState | null;
  fileDiff?: FileDiffMetadata;
  fallbackFileDiff?: FileDiffMetadata;
  difftDecorations?: DifftFileDecorations;
  contextMode: DiffContextMode;
  difftError?: string;
}
