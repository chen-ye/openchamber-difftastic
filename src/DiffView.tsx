import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { HostClient, HostReadyContext } from '@openchamber/sdk';
import type { FileDiffMetadata } from '@pierre/diffs';
import { Icon } from './icons';
import {
  ChangeScopeSelector,
  BranchComparisonSelector,
  BranchTargetSelector,
  CommitComparisonSelector,
  PullRequestComparisonSelector,
  PullRequestCommitRangeSelector,
  NestedRepoPicker,
  DiffViewToggle,
  ToolbarIconButton,
  type BranchTargetValue,
  type PrCommitRangeValue,
} from './Selectors';
import {
  PierreDiffViewer,
  type ContextExpansionRequest,
  type DiffFindSide,
  type PierreDiffViewerHandle,
} from './PierreDiffViewer';
import { adaptDifftToViewModel } from './difftToFileDiff';
import { buildDiffTreeRows, TREE_INDENT_PX } from './changesTree';
import {
  describeChange,
  isNewStatusFile,
  isStagedStatusFile,
  isWorkingStatusFile,
} from './changeStatus';
import {
  branchRefLabel,
  isBranchScopeAvailable,
  resolveBranchComparisonBase,
} from './baseBranch';
import { chooseAutoNestedRepo, discoversNestedRepos } from './nestedRepositories';
import { ensureHostPierreThemeRegistered } from './pierreTheme';
import type {
  DiffData,
  DiffScope,
  DiffViewMode,
  FileEntry,
  GitCommitFile,
  GitDirectoriesResponse,
  GitLogEntry,
  GitPathUnavailableReason,
  GitPullRequestCommit,
  GitPullRequestEntry,
  GitPullRequestFile,
  GitRangeFile,
  GitStatusResponse,
  GitSubmoduleState,
  PrFileViewedState,
  ServiceFileDiffResponse,
} from './types';

const SIDE_BY_SIDE_MIN_WIDTH = 900;
const LARGE_DIFF_CHANGED_LINES = 500;
const STACKED_DIFF_MOUNT_MARGIN = 300;
const FILE_TREE_MIN_WIDTH = 160;
const FILE_TREE_MAX_FRACTION = 0.5;

const getStackedViewDefaultExpandedCount = (fileCount: number): number => {
  if (fileCount <= 6) return fileCount;
  if (fileCount <= 12) return 6;
  if (fileCount <= 25) return 4;
  return 2;
};

const formatDiffTotals = (insertions?: number, deletions?: number) => {
  const added = insertions ?? 0;
  const removed = deletions ?? 0;
  if (!added && !removed) return null;
  return (
    <span className="oc-diff-totals">
      {added ? <span style={{ color: 'var(--status-success)' }}>+{added}</span> : null}
      {removed ? <span style={{ color: 'var(--status-error)' }}>-{removed}</span> : null}
    </span>
  );
};

const toAbsolutePath = (directory: string, filePath: string): string => {
  const cleanDir = directory.replace(/\/+$/, '');
  const cleanRel = filePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return cleanRel ? `${cleanDir}/${cleanRel}` : cleanDir;
};

const SubmoduleDiffSummary: React.FC<{
  state: GitSubmoduleState;
  staged: boolean;
  onOpenRepository?: () => void;
}> = ({ state, staged, onOpenRepository }) => {
  const shortCommit = (c: string) => c.slice(0, 7);
  const from = staged ? state.headCommit : state.indexCommit;
  const to = staged ? state.indexCommit : state.worktreeCommit;

  let commitLine: string | null = null;
  if (state.hasConflict) {
    commitLine = 'Submodule has merge conflicts';
  } else if (from && to) {
    commitLine =
      from === to
        ? `Submodule commit ${shortCommit(to)} (unchanged)`
        : `Submodule commit changed from ${shortCommit(from)} to ${shortCommit(to)}`;
  } else if (to) {
    commitLine = `Submodule added at commit ${shortCommit(to)}`;
  } else if (from) {
    commitLine = staged
      ? `Submodule removed (was ${shortCommit(from)})`
      : `Submodule not checked out (expected ${shortCommit(from)})`;
  }

  return (
    <div className="oc-submodule-box">
      <div className="oc-submodule-header">
        <div>
          <div className="oc-submodule-title">Git submodule</div>
          {commitLine ? <div className="oc-submodule-meta">{commitLine}</div> : null}
          {!staged && state.hasTrackedChanges ? (
            <div className="oc-submodule-meta">Has modified tracked content inside submodule</div>
          ) : null}
          {!staged && state.hasUntrackedFiles ? (
            <div className="oc-submodule-meta">Has untracked files inside submodule</div>
          ) : null}
        </div>
        {onOpenRepository && state.worktreeCommit ? (
          <button type="button" className="oc-submodule-open-btn" onClick={onOpenRepository}>
            Switch to submodule
          </button>
        ) : null}
      </div>
    </div>
  );
};

const toNestedFileEntries = (status: GitStatusResponse): FileEntry[] =>
  status.files
    .map((file) => {
      const staged = status.diffStats?.staged?.[file.path];
      const working = status.diffStats?.working?.[file.path];
      return {
        ...file,
        insertions: (staged?.insertions ?? 0) + (working?.insertions ?? 0),
        deletions: (staged?.deletions ?? 0) + (working?.deletions ?? 0),
        isNew: isNewStatusFile(file),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

const NestedRepositoryFileDiff: React.FC<{
  directory: string;
  file: FileEntry;
  revision: number;
  renderSideBySide: boolean;
  wrapLines: boolean;
  ignoreComments: boolean;
  themeId: string;
  isDark: boolean;
  serviceGet: <T>(path: string, query: Record<string, string>) => Promise<T>;
}> = ({
  directory,
  file,
  revision,
  renderSideBySide,
  wrapLines,
  ignoreComments,
  themeId,
  isDark,
  serviceGet,
}) => {
  const [response, setResponse] = useState<ServiceFileDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullContext, setFullContext] = useState(false);
  const [forceLineDiff, setForceLineDiff] = useState(false);

  const staged = isStagedStatusFile(file) && !isWorkingStatusFile(file);
  const scope: DiffScope = staged ? 'staged' : 'working';
  const isRenamedInScope =
    scope === 'staged'
      ? file.index === 'R' || file.index === 'C'
      : file.working_dir === 'R' || file.working_dir === 'C';
  const effectivePreviousPath = isRenamedInScope ? file.previousPath : undefined;
  const fileStatusKey = `${file.index}:${file.working_dir}:${file.insertions}:${file.deletions}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query: Record<string, string> = {
      directory,
      scope,
      path: file.path,
      ignoreComments: ignoreComments ? 'true' : 'false',
    };
    if (effectivePreviousPath) query.previousPath = effectivePreviousPath;

    serviceGet<ServiceFileDiffResponse>('/file-diff', query)
      .then((res) => {
        if (cancelled) return;
        setResponse(res);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [directory, effectivePreviousPath, file.path, fileStatusKey, ignoreComments, revision, scope, serviceGet]);

  const adapted = useMemo(() => {
    if (
      !response ||
      response.unavailableReason ||
      response.submodule ||
      response.isBinary ||
      response.isImage
    ) {
      return null;
    }
    return adaptDifftToViewModel({
      filePath: file.path,
      previousPath: effectivePreviousPath,
      original: response.original,
      modified: response.modified,
      difft: response.difft,
      contextLines: 3,
      fullContext,
    });
  }, [effectivePreviousPath, file.path, fullContext, response]);

  if (loading && !response) {
    return (
      <div className="oc-diff-entry-status">
        <Icon name="loader-4" className="oc-icon oc-spin" />
        <span>Loading nested diff…</span>
      </div>
    );
  }
  if (error) {
    return <div className="oc-diff-entry-status">{error}</div>;
  }
  if (!response) return null;
  if (response.unavailableReason) {
    return (
      <div className="oc-diff-entry-status">
        {response.unavailableReason === 'nested_repository'
          ? 'Separate Git repository'
          : response.unavailableReason === 'untracked_directory'
            ? 'Directory of untracked files'
            : 'File no longer available'}
      </div>
    );
  }
  if (response.submodule) {
    return <SubmoduleDiffSummary state={response.submodule} staged={staged} />;
  }
  if (response.isImage) {
    return (
      <InlineImageDiffViewer
        filePath={file.path}
        diff={{
          original: response.original,
          modified: response.modified,
          isImage: true,
          contextMode: 'full',
        }}
        renderSideBySide={renderSideBySide}
      />
    );
  }
  if (response.isBinary) {
    return <div className="oc-diff-entry-status">Binary file changed</div>;
  }
  if (!adapted) return null;

  const activeFileDiff = forceLineDiff ? adapted.fallbackFileDiff : adapted.fileDiff;
  if (!forceLineDiff && activeFileDiff.hunks.length === 0) {
    return (
      <div className="oc-diff-entry-status oc-diff-entry-status--col">
        <div className="oc-diff-entry-status-desc">
          No structural syntax changes detected by Difftastic.
        </div>
        {adapted.fallbackFileDiff.hunks.length > 0 ? (
          <button type="button" className="oc-link-btn" onClick={() => setForceLineDiff(true)}>
            Show line diff anyway
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <PierreDiffViewer
      fileDiff={activeFileDiff}
      difftDecorations={forceLineDiff ? undefined : adapted.difftDecorations}
      themeId={themeId}
      isDark={isDark}
      renderSideBySide={renderSideBySide}
      wrapLines={wrapLines}
      onExpandContextRequest={!fullContext && !forceLineDiff ? () => setFullContext(true) : undefined}
    />
  );
};

const NestedRepositoryChanges: React.FC<{
  directory: string;
  revision: number;
  renderSideBySide: boolean;
  wrapLines: boolean;
  ignoreComments: boolean;
  themeId: string;
  isDark: boolean;
  serviceGet: <T>(path: string, query: Record<string, string>) => Promise<T>;
  onSwitchToRepository?: () => void;
  hideHeader?: boolean;
}> = ({
  directory,
  revision,
  renderSideBySide,
  wrapLines,
  ignoreComments,
  themeId,
  isDark,
  serviceGet,
  onSwitchToRepository,
  hideHeader = false,
}) => {
  const [status, setStatus] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; files: FileEntry[] }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  const [retryNonce, setRetryNonce] = useState(0);
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    serviceGet<GitStatusResponse>('/status', { directory })
      .then((next) => {
        if (cancelled) return;
        setStatus({ kind: 'ready', files: toNestedFileEntries(next) });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [directory, revision, retryNonce, serviceGet]);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (!next.delete(filePath)) next.add(filePath);
      return next;
    });
  }, []);

  return (
    <div className="oc-nested-repo-box">
      {!hideHeader ? (
        <div className="oc-nested-repo-header">
          <div className="oc-nested-repo-header-text">
            <div className="oc-nested-repo-title">Separate Git repository</div>
            <div className="oc-nested-repo-desc">
              This directory is its own Git repository. Its uncommitted changes are shown below.
            </div>
          </div>
          {onSwitchToRepository ? (
            <button
              type="button"
              className="oc-submodule-open-btn"
              onClick={onSwitchToRepository}
            >
              Switch to repository
            </button>
          ) : null}
        </div>
      ) : null}
      {status.kind === 'loading' ? (
        <div className="oc-diff-entry-status">
          <Icon name="loader-4" className="oc-icon oc-spin" />
          <span>Loading nested repository changes…</span>
        </div>
      ) : null}
      {status.kind === 'error' ? (
        <div className="oc-diff-entry-status oc-diff-entry-status--col">
          <div className="oc-diff-entry-status-title">Failed to read nested repository</div>
          <div className="oc-diff-entry-status-desc">{status.message}</div>
          <button
            type="button"
            className="oc-link-btn"
            onClick={() => setRetryNonce((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}
      {status.kind === 'ready' && status.files.length === 0 ? (
        <div className="oc-nested-repo-empty">No uncommitted changes inside this repository.</div>
      ) : null}
      {status.kind === 'ready' && status.files.length > 0 ? (
        <ul className="oc-nested-repo-list">
          {status.files.map((nestedFile) => {
            const isOpen = expandedFiles.has(nestedFile.path);
            const descriptor = describeChange(nestedFile);
            return (
              <li key={nestedFile.path} className="oc-nested-repo-item">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleFile(nestedFile.path)}
                  className="oc-nested-repo-file-btn"
                  title={nestedFile.path}
                >
                  <Icon
                    name={isOpen ? 'arrow-down-s' : 'arrow-right-s'}
                    className="oc-icon-sm oc-muted-icon"
                  />
                  <span
                    className="oc-status-letter"
                    style={{ color: descriptor.color }}
                    title={descriptor.label}
                  >
                    {descriptor.code}
                  </span>
                  <Icon name="file-code" className="oc-icon-sm oc-shrink-0" />
                  <span
                    className="oc-file-row-path"
                    style={{ direction: 'rtl', unicodeBidi: 'plaintext' }}
                  >
                    {nestedFile.path}
                  </span>
                  {formatDiffTotals(nestedFile.insertions, nestedFile.deletions)}
                </button>
                {isOpen ? (
                  <NestedRepositoryFileDiff
                    directory={directory}
                    file={nestedFile}
                    revision={revision}
                    renderSideBySide={renderSideBySide}
                    wrapLines={wrapLines}
                    ignoreComments={ignoreComments}
                    themeId={themeId}
                    isDark={isDark}
                    serviceGet={serviceGet}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

interface FileListProps {
  changedFiles: FileEntry[];
  scope: DiffScope;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

const FileList = React.memo<FileListProps>(
  ({ changedFiles, scope, selectedFile, onSelectFile }) => {
    if (changedFiles.length === 0) return null;
    return (
      <div className="oc-file-list-scroll">
        <ul className="oc-file-list">
          {changedFiles.map((file) => {
            const descriptor = describeChange(file, scope);
            const isActive = selectedFile === file.path;
            const isViewed = file.viewedState === 'VIEWED';
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  className={`oc-file-row ${isActive ? 'oc-file-row--active' : ''} ${
                    isViewed ? 'oc-file-row--viewed' : ''
                  }`}
                  title={file.path}
                >
                  <Icon name="file-code" className="oc-icon-sm oc-shrink-0" />
                  <span
                    className="oc-status-letter"
                    style={{ color: descriptor.color }}
                    title={descriptor.label}
                  >
                    {descriptor.code}
                  </span>
                  <span
                    className="oc-file-row-path"
                    style={{ direction: 'rtl', unicodeBidi: 'plaintext' }}
                  >
                    {file.path}
                  </span>
                  {isViewed ? (
                    <Icon
                      name="check"
                      className="oc-icon-sm oc-shrink-0"
                      style={{ color: 'var(--status-success)' }}
                    />
                  ) : null}
                  {formatDiffTotals(file.insertions, file.deletions)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  },
);

const FileTree = React.memo<FileListProps>(
  ({ changedFiles, scope, selectedFile, onSelectFile }) => {
    const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(
      () => new Set(),
    );
    const rows = useMemo(
      () => buildDiffTreeRows(changedFiles, collapsedDirectories),
      [changedFiles, collapsedDirectories],
    );

    useEffect(() => {
      if (!selectedFile) return;
      setCollapsedDirectories((previous) => {
        const hiding = Array.from(previous).filter((path) => selectedFile.startsWith(`${path}/`));
        if (hiding.length === 0) return previous;
        const next = new Set(previous);
        hiding.forEach((path) => next.delete(path));
        return next;
      });
    }, [selectedFile]);

    const toggleDirectory = useCallback((path: string) => {
      setCollapsedDirectories((previous) => {
        const next = new Set(previous);
        if (!next.delete(path)) next.add(path);
        return next;
      });
    }, []);

    return (
      <div className="oc-file-tree-scroll">
        <ul className="oc-file-tree">
          {rows.map((row) => {
            const paddingLeft = 6 + row.depth * TREE_INDENT_PX;
            if (row.kind === 'directory') {
              return (
                <li key={row.key} className="oc-tree-li">
                  <button
                    type="button"
                    onClick={() => toggleDirectory(row.path)}
                    aria-expanded={row.expanded}
                    className="oc-tree-row oc-tree-row--dir"
                    style={{ paddingInlineStart: `${paddingLeft}px` }}
                    title={row.path}
                  >
                    <Icon
                      name={row.expanded ? 'arrow-down-s' : 'arrow-right-s'}
                      className="oc-icon-sm oc-shrink-0"
                    />
                    <span className="oc-tree-row-name">{row.label}</span>
                  </button>
                </li>
              );
            }

            const descriptor = describeChange(row.file, scope);
            const isActive = selectedFile === row.file.path;
            const isViewed = row.file.viewedState === 'VIEWED';
            return (
              <li key={row.key} className="oc-tree-li">
                <button
                  type="button"
                  onClick={() => onSelectFile(row.file.path)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`oc-tree-row ${isActive ? 'oc-tree-row--active' : ''} ${
                    isViewed ? 'oc-tree-row--viewed' : ''
                  }`}
                  style={{ paddingInlineStart: `${paddingLeft}px` }}
                  title={row.file.path}
                >
                  <Icon name="file-code" className="oc-icon-sm oc-shrink-0" />
                  <span className="oc-tree-row-name">{row.name}</span>
                  <span className="oc-tree-row-end">
                    {isViewed ? (
                      <Icon
                        name="check"
                        className="oc-icon-sm oc-shrink-0"
                        style={{ color: 'var(--status-success)' }}
                      />
                    ) : null}
                    <span
                      className="oc-status-letter"
                      style={{ color: descriptor.color }}
                      title={descriptor.label}
                    >
                      {descriptor.code}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  },
);

const InlineImageDiffViewer: React.FC<{
  filePath: string;
  diff: DiffData;
  renderSideBySide: boolean;
}> = ({ filePath, diff, renderSideBySide }) => {
  const hasOriginal = diff.original.length > 0;
  const hasModified = diff.modified.length > 0;
  return (
    <div className="oc-image-diff-wrap">
      <div
        className={
          renderSideBySide ? 'oc-image-diff-grid oc-image-diff-grid--split' : 'oc-image-diff-grid'
        }
      >
        {hasOriginal ? (
          <div className="oc-image-diff-col">
            <span className="oc-image-diff-label">Original</span>
            <img src={diff.original} alt={`Original ${filePath}`} className="oc-image-diff-img" />
          </div>
        ) : null}
        {hasModified ? (
          <div className="oc-image-diff-col">
            <span className="oc-image-diff-label">{hasOriginal ? 'Modified' : 'New'}</span>
            <img src={diff.modified} alt={`Modified ${filePath}`} className="oc-image-diff-img" />
          </div>
        ) : null}
      </div>
    </div>
  );
};

interface MultiFileDiffEntryProps {
  visible: boolean;
  directory: string;
  file: FileEntry;
  scope: DiffScope;
  layout: 'inline' | 'side-by-side';
  wrapLines: boolean;
  ignoreComments: boolean;
  themeId: string;
  isDark: boolean;
  isExpanded: boolean;
  isMounted: boolean;
  revision: number;
  onExpandedChange: (path: string, expanded: boolean) => void;
  onLayoutChange: (path: string, layout: 'inline' | 'side-by-side') => void;
  registerSectionRef: (path: string, node: HTMLDivElement | null) => void;
  registerViewerRef: (path: string, handle: PierreDiffViewerHandle | null) => void;
  fetchFileDiff: (file: FileEntry) => Promise<ServiceFileDiffResponse>;
  serviceGet: <T>(path: string, query: Record<string, string>) => Promise<T>;
  onSelectRepository?: (repoPath: string) => void;
  onToggleViewed?: (filePath: string, viewed: boolean) => void;
  requestKeyPrefix: string;
  onDiffLoaded?: (path: string, fileDiff: FileDiffMetadata | null) => void;
}

const MultiFileDiffEntry = React.memo<MultiFileDiffEntryProps>(
  ({
    visible,
    directory,
    file,
    scope,
    layout,
    wrapLines,
    ignoreComments,
    themeId,
    isDark,
    isExpanded,
    isMounted,
    revision,
    onExpandedChange,
    onLayoutChange,
    registerSectionRef,
    registerViewerRef,
    fetchFileDiff,
    serviceGet,
    onSelectRepository,
    onToggleViewed,
    requestKeyPrefix,
    onDiffLoaded,
  }) => {
    const [rawResponse, setRawResponse] = useState<{
      key: string;
      response: ServiceFileDiffResponse;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const [fullContext, setFullContext] = useState(false);
    const [forceLineDiff, setForceLineDiff] = useState(false);
    const [forceRenderLarge, setForceRenderLarge] = useState(false);

    const requestKey = `${requestKeyPrefix}::${file.path}::${file.previousPath ?? ''}::${file.index}:${file.working_dir}:${file.insertions}:${file.deletions}:${file.revision ?? ''}::${retryNonce}`;
    const currentResponse = rawResponse?.key === requestKey ? rawResponse.response : null;
    const unavailableReason: GitPathUnavailableReason | undefined =
      currentResponse?.unavailableReason;

    useEffect(() => {
      setFullContext(false);
      setForceLineDiff(false);
    }, [requestKeyPrefix, file.path]);

    useEffect(() => {
      if (!visible || !isExpanded || !isMounted) return;
      if (currentResponse) return;

      let cancelled = false;
      setLoading(true);
      setError(null);

      fetchFileDiff(file)
        .then((response) => {
          if (cancelled) return;
          setRawResponse({ key: requestKey, response });
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [currentResponse, fetchFileDiff, file, isExpanded, isMounted, requestKey, visible]);

    const diffData = useMemo<DiffData | null>(() => {
      if (!currentResponse || error || currentResponse.unavailableReason) return null;
      if (currentResponse.submodule) {
        return {
          original: '',
          modified: '',
          submodule: currentResponse.submodule,
          contextMode: 'full',
        };
      }
      if (currentResponse.isBinary || currentResponse.isImage) {
        return {
          original: currentResponse.original,
          modified: currentResponse.modified,
          isBinary: currentResponse.isBinary,
          isImage: currentResponse.isImage,
          contextMode: 'full',
        };
      }

      const adapted = adaptDifftToViewModel({
        filePath: file.path,
        previousPath: file.previousPath,
        original: currentResponse.original,
        modified: currentResponse.modified,
        difft: currentResponse.difft,
        contextLines: 3,
        fullContext,
      });

      return {
        original: currentResponse.original,
        modified: currentResponse.modified,
        fileDiff: adapted.fileDiff,
        fallbackFileDiff: adapted.fallbackFileDiff,
        difftDecorations: adapted.difftDecorations,
        contextMode: fullContext ? 'full' : 'patch',
        difftError: currentResponse.difftError,
      };
    }, [currentResponse, error, file.path, file.previousPath, fullContext]);

    const activeFileDiff = useMemo<FileDiffMetadata | null>(() => {
      if (!diffData || !isExpanded || !isMounted || diffData.submodule) return null;
      if (forceLineDiff && diffData.fallbackFileDiff) return diffData.fallbackFileDiff;
      return diffData.fileDiff ?? null;
    }, [diffData, forceLineDiff, isExpanded, isMounted]);

    useEffect(() => {
      onDiffLoaded?.(file.path, activeFileDiff);
      return () => {
        onDiffLoaded?.(file.path, null);
      };
    }, [activeFileDiff, file.path, onDiffLoaded]);

    const setSectionNode = useCallback(
      (node: HTMLDivElement | null) => {
        registerSectionRef(file.path, node);
      },
      [file.path, registerSectionRef],
    );

    const setViewerHandle = useCallback(
      (handle: PierreDiffViewerHandle | null) => {
        registerViewerRef(file.path, handle);
      },
      [file.path, registerViewerRef],
    );

    const handleExpandContext = useCallback((_req: ContextExpansionRequest) => {
      setFullContext(true);
    }, []);

    const descriptor = useMemo(() => describeChange(file, scope), [file, scope]);
    const renderSideBySide = layout === 'side-by-side';
    const languageLabel = diffData?.difftDecorations?.language;
    const isStructurallyUnchanged =
      diffData &&
      !diffData.submodule &&
      !diffData.isBinary &&
      !diffData.isImage &&
      !forceLineDiff &&
      (diffData.fileDiff?.hunks.length ?? 0) === 0;
    const nestedAbsPath = toAbsolutePath(directory, file.path);

    return (
      <div ref={setSectionNode} className="oc-diff-entry">
        <div className="oc-diff-entry-header-sticky">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onExpandedChange(file.path, !isExpanded)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onExpandedChange(file.path, !isExpanded);
              }
            }}
            className="oc-diff-entry-header"
          >
            <div className="oc-diff-entry-header-left">
              <span className="oc-diff-entry-chevron">
                <Icon name={isExpanded ? 'arrow-down-s' : 'arrow-right-s'} className="oc-icon" />
              </span>
              <span
                className="oc-status-letter"
                style={{ color: descriptor.color }}
                title={descriptor.label}
              >
                {descriptor.code}
              </span>
              <span className="oc-diff-entry-path-wrap" title={file.path}>
                <Icon name="file-code" className="oc-icon-sm oc-shrink-0" />
                {(() => {
                  const lastSlash = file.path.lastIndexOf('/');
                  if (lastSlash === -1) {
                    return <span className="oc-diff-entry-filename">{file.path}</span>;
                  }
                  const dir = file.path.slice(0, lastSlash);
                  const name = file.path.slice(lastSlash + 1);
                  return (
                    <span dir="ltr" className="oc-diff-entry-dir-split">
                      <span
                        className="oc-diff-entry-dirname"
                        style={{ direction: 'rtl', unicodeBidi: 'plaintext' }}
                      >
                        {dir}
                      </span>
                      <span className="oc-diff-entry-slash-name">
                        <span className="oc-diff-entry-slash">/</span>
                        <span className="oc-diff-entry-filename">{name}</span>
                      </span>
                    </span>
                  );
                })()}
              </span>
            </div>
            <div className="oc-diff-entry-header-right">
              {scope === 'pr' && file.viewedState === 'DISMISSED' ? (
                <span className="oc-viewed-dismissed-badge" title="Changed since last viewed">
                  Changed since viewed
                </span>
              ) : null}
              {scope === 'pr' && onToggleViewed ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={file.viewedState === 'VIEWED'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleViewed(file.path, file.viewedState !== 'VIEWED');
                  }}
                  className={`oc-viewed-toggle ${
                    file.viewedState === 'VIEWED' ? 'oc-viewed-toggle--checked' : ''
                  }`}
                  title="Mark file as viewed on GitHub"
                >
                  <span className="oc-viewed-checkbox">
                    {file.viewedState === 'VIEWED' ? (
                      <Icon name="check" className="oc-icon-sm" />
                    ) : null}
                  </span>
                  <span>Viewed</span>
                </button>
              ) : null}
              {languageLabel && languageLabel !== 'Text' ? (
                <span className="oc-difft-lang-badge" title={`Difftastic language: ${languageLabel}`}>
                  {languageLabel}
                </span>
              ) : null}
              {formatDiffTotals(file.insertions, file.deletions)}
              <DiffViewToggle
                mode={renderSideBySide ? 'side-by-side' : 'unified'}
                onModeChange={(mode) =>
                  onLayoutChange(file.path, mode === 'side-by-side' ? 'side-by-side' : 'inline')
                }
              />
            </div>
          </div>
        </div>
        {isExpanded ? (
          <div className="oc-diff-entry-body">
            {!isMounted && !error ? <div className="oc-diff-entry-placeholder" /> : null}
            {isMounted && loading && !diffData && !unavailableReason && !error ? (
              <div className="oc-diff-entry-status">
                <Icon name="loader-4" className="oc-icon oc-spin" />
                <span>Loading structural diff…</span>
              </div>
            ) : null}
            {isMounted && unavailableReason === 'nested_repository' ? (
              <NestedRepositoryChanges
                directory={nestedAbsPath}
                revision={revision}
                renderSideBySide={renderSideBySide}
                wrapLines={wrapLines}
                ignoreComments={ignoreComments}
                themeId={themeId}
                isDark={isDark}
                serviceGet={serviceGet}
                onSwitchToRepository={
                  onSelectRepository ? () => onSelectRepository(nestedAbsPath) : undefined
                }
              />
            ) : null}
            {isMounted && unavailableReason && unavailableReason !== 'nested_repository' ? (
              <div className="oc-diff-entry-status oc-diff-entry-status--col">
                <div className="oc-diff-entry-status-title">
                  {unavailableReason === 'untracked_directory'
                    ? 'Directory of untracked files'
                    : 'File no longer available'}
                </div>
                <div className="oc-diff-entry-status-desc">
                  {unavailableReason === 'untracked_directory'
                    ? 'This path is an unexpanded directory of untracked files.'
                    : 'This path is missing from the working tree and index.'}
                </div>
              </div>
            ) : null}
            {error ? (
              <div className="oc-diff-entry-status oc-diff-entry-status--col">
                <div className="oc-diff-entry-status-title">Failed to load diff</div>
                <div className="oc-diff-entry-status-desc">{error}</div>
                <button
                  type="button"
                  className="oc-link-btn"
                  onClick={() => setRetryNonce((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            ) : null}
            {isMounted && diffData?.submodule ? (
              <div>
                <SubmoduleDiffSummary
                  state={diffData.submodule}
                  staged={scope === 'staged'}
                  onOpenRepository={
                    onSelectRepository ? () => onSelectRepository(nestedAbsPath) : undefined
                  }
                />
                {scope !== 'staged' &&
                diffData.submodule.worktreeCommit &&
                (diffData.submodule.hasTrackedChanges || diffData.submodule.hasUntrackedFiles) ? (
                  <NestedRepositoryChanges
                    directory={nestedAbsPath}
                    revision={revision}
                    renderSideBySide={renderSideBySide}
                    wrapLines={wrapLines}
                    ignoreComments={ignoreComments}
                    themeId={themeId}
                    isDark={isDark}
                    serviceGet={serviceGet}
                    hideHeader
                  />
                ) : null}
              </div>
            ) : null}
            {isMounted &&
            diffData &&
            !diffData.submodule &&
            !forceRenderLarge &&
            file.insertions + file.deletions > LARGE_DIFF_CHANGED_LINES ? (
              <div className="oc-diff-entry-status oc-diff-entry-status--col">
                <div className="oc-diff-entry-status-title">
                  Large diff ({file.insertions + file.deletions} lines changed)
                </div>
                <button
                  type="button"
                  className="oc-link-btn"
                  onClick={() => setForceRenderLarge(true)}
                >
                  Render anyway
                </button>
              </div>
            ) : null}
            {isMounted &&
            diffData &&
            !diffData.submodule &&
            (forceRenderLarge || file.insertions + file.deletions <= LARGE_DIFF_CHANGED_LINES) ? (
              diffData.isImage ? (
                <InlineImageDiffViewer
                  filePath={file.path}
                  diff={diffData}
                  renderSideBySide={renderSideBySide}
                />
              ) : diffData.isBinary ? (
                <div className="oc-diff-entry-status">Binary file changed</div>
              ) : isStructurallyUnchanged ? (
                <div className="oc-diff-entry-status oc-diff-entry-status--col">
                  <div className="oc-diff-entry-status-desc">
                    No structural syntax changes detected by Difftastic (whitespace or comments only).
                  </div>
                  {(diffData.fallbackFileDiff?.hunks.length ?? 0) > 0 ? (
                    <button
                      type="button"
                      className="oc-link-btn"
                      onClick={() => setForceLineDiff(true)}
                    >
                      Show line diff anyway
                    </button>
                  ) : null}
                </div>
              ) : activeFileDiff ? (
                <PierreDiffViewer
                  ref={setViewerHandle}
                  fileDiff={activeFileDiff}
                  difftDecorations={forceLineDiff ? undefined : diffData.difftDecorations}
                  themeId={themeId}
                  isDark={isDark}
                  renderSideBySide={renderSideBySide}
                  wrapLines={wrapLines}
                  onExpandContextRequest={!fullContext && !forceLineDiff ? handleExpandContext : undefined}
                />
              ) : null
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);

interface FindMatch {
  filePath: string;
  lineNumber: number;
  side: DiffFindSide;
  spanStart: number;
  spanLength: number;
}

const searchFileDiff = (
  filePath: string,
  fileDiff: FileDiffMetadata,
  query: string,
): FindMatch[] => {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];

  const scanLine = (text: string, lineNumber: number, side: DiffFindSide) => {
    const clean = text.replace(/\r?\n$/, '').toLowerCase();
    let from = 0;
    while (from <= clean.length - needle.length) {
      const idx = clean.indexOf(needle, from);
      if (idx === -1) break;
      matches.push({
        filePath,
        lineNumber,
        side,
        spanStart: idx,
        spanLength: needle.length,
      });
      from = idx + Math.max(1, needle.length);
    }
  };

  for (const hunk of fileDiff.hunks) {
    let delLine = hunk.deletionStart;
    let addLine = hunk.additionStart;
    for (const block of hunk.hunkContent) {
      if (block.type === 'context') {
        for (let i = 0; i < block.lines; i += 1) {
          scanLine(fileDiff.additionLines[block.additionLineIndex + i] ?? '', addLine + i, 'additions');
        }
        delLine += block.lines;
        addLine += block.lines;
      } else {
        for (let i = 0; i < block.deletions; i += 1) {
          scanLine(fileDiff.deletionLines[block.deletionLineIndex + i] ?? '', delLine + i, 'deletions');
        }
        for (let j = 0; j < block.additions; j += 1) {
          scanLine(fileDiff.additionLines[block.additionLineIndex + j] ?? '', addLine + j, 'additions');
        }
        delLine += block.deletions;
        addLine += block.additions;
      }
    }
  }
  return matches;
};

export interface DiffViewProps {
  host: HostClient;
  ready: HostReadyContext;
  directory: string | null;
  lifecycleTick: number;
}

export const DiffView: React.FC<DiffViewProps> = ({
  host,
  ready,
  directory: rootDirectory,
  lifecycleTick,
}) => {
  // Nested repository discovery & selection (mirroring useNestedGitDirectory)
  const [rootStatusState, setRootStatusState] = useState<{
    directory: string;
    data: GitStatusResponse;
  } | null>(null);
  const [rootNestedReposState, setRootNestedReposState] = useState<{
    directory: string;
    repos: string[];
  } | null>(null);
  const [selectedNestedByRoot, setSelectedNestedByRoot] = useState<
    Record<string, { path: string; auto: boolean }>
  >({});
  const [staleClearedByRoot, setStaleClearedByRoot] = useState<
    Record<string, ReadonlySet<string>>
  >({});
  const [currentNestedReposState, setCurrentNestedReposState] = useState<{
    directory: string;
    repos: string[];
  } | null>(null);

  const [statusState, setStatusState] = useState<{
    directory: string;
    data: GitStatusResponse;
  } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [activeScope, setActiveScope] = useState<DiffScope>('branch');
  const [userPickedScope, setUserPickedScope] = useState(false);
  const [baseOverrides, setBaseOverrides] = useState<Record<string, string>>({});
  const [branchTargets, setBranchTargets] = useState<Record<string, BranchTargetValue>>({});

  const [branchFilesState, setBranchFilesState] = useState<{
    key: string;
    files: GitRangeFile[];
  } | null>(null);
  const [branchFilesLoading, setBranchFilesLoading] = useState(false);
  const [branchFilesError, setBranchFilesError] = useState<string | null>(null);

  const [commitsState, setCommitsState] = useState<{
    directory: string;
    commits: GitLogEntry[];
  } | null>(null);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitFilesState, setCommitFilesState] = useState<{
    key: string;
    files: GitCommitFile[];
  } | null>(null);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [commitFilesError, setCommitFilesError] = useState<string | null>(null);

  // Pull requests comparison state
  const [prsState, setPrsState] = useState<{
    directory: string;
    prs: GitPullRequestEntry[];
    available: boolean;
  } | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [prCommitRanges, setPrCommitRanges] = useState<Record<string, PrCommitRangeValue>>({});
  const [viewedOverrides, setViewedOverrides] = useState<Record<string, PrFileViewedState>>({});
  const commitsRequestSeqRef = useRef(0);
  const prsRequestSeqRef = useRef(0);
  const [prFilesState, setPrFilesState] = useState<{
    key: string;
    prLookupKey: string;
    pullRequestNodeId: string | null;
    files: GitPullRequestFile[];
    commits: GitPullRequestCommit[];
    baseRefOid: string;
    headRefOid: string;
  } | null>(null);
  const [prFilesLoading, setPrFilesLoading] = useState(false);
  const [prFilesError, setPrFilesError] = useState<string | null>(null);

  const [fileListMode, setFileListMode] = useState<'flat' | 'tree'>('flat');
  const [wrapLines, setWrapLines] = useState(false);
  const [ignoreComments, setIgnoreComments] = useState(false);
  const [globalLayout, setGlobalLayout] = useState<'inline' | 'side-by-side' | null>(null);
  const [perFileLayout, setPerFileLayout] = useState<Record<string, 'inline' | 'side-by-side'>>({});
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());
  const [mountedStackedFiles, setMountedStackedFiles] = useState<Set<string>>(() => new Set());
  const [displayFile, setDisplayFile] = useState<string | null>(null);
  const [fileTreeWidth, setFileTreeWidth] = useState(240);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );

  // Find in diff
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [loadedDiffsVersion, setLoadedDiffsVersion] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const loadedDiffsRef = useRef<Map<string, FileDiffMetadata>>(new Map());

  const diffScrollRef = useRef<HTMLDivElement | null>(null);
  const fileTreeLayoutRef = useRef<HTMLDivElement | null>(null);
  const fileSectionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const viewerRefs = useRef<Map<string, PierreDiffViewerHandle>>(new Map());
  const stackedScopeRef = useRef<string | null>(null);

  const themeId = useMemo(() => ensureHostPierreThemeRegistered(ready.theme), [ready.theme]);
  const isDark = ready.theme.mode === 'dark';

  const serviceGet = useCallback(
    async <T,>(path: string, query: Record<string, string>): Promise<T> => {
      const response = await host.serviceRequest({
        method: 'GET',
        path,
        query,
      });
      const parsed = JSON.parse(response.body) as T & { error?: string; message?: string };
      if (response.status < 200 || response.status >= 300) {
        throw new Error(parsed.message || parsed.error || `Service HTTP ${response.status}`);
      }
      return parsed;
    },
    [host],
  );

  // 1. Probe rootDirectory and discover nested repositories under rootDirectory
  useEffect(() => {
    if (!rootDirectory) {
      setRootStatusState(null);
      setRootNestedReposState(null);
      return;
    }
    let cancelled = false;

    serviceGet<GitStatusResponse>('/status', { directory: rootDirectory })
      .then((res) => {
        if (cancelled) return;
        setRootStatusState({ directory: rootDirectory, data: res });
        if (discoversNestedRepos(rootDirectory, res.homeDirectory)) {
          return serviceGet<GitDirectoriesResponse>('/git-dirs', { directory: rootDirectory });
        }
        return null;
      })
      .then((dirsRes) => {
        if (cancelled || !dirsRes) return;
        setRootNestedReposState({
          directory: rootDirectory,
          repos: dirsRes.repositories.map((r) => r.path),
        });
      })
      .catch(() => {
        // handled by effectiveDirectory status load below
      });

    return () => {
      cancelled = true;
    };
  }, [lifecycleTick, refreshTick, rootDirectory, serviceGet]);

  const rootStatus = rootStatusState?.directory === rootDirectory ? rootStatusState.data : null;
  const rootIsGitRepo = rootStatus ? rootStatus.isGitRepo : null;
  const rootNestedRepos =
    rootNestedReposState?.directory === rootDirectory ? rootNestedReposState.repos : null;
  const rootSelection = rootDirectory ? selectedNestedByRoot[rootDirectory] ?? null : null;
  const staleClearedSelections = rootDirectory ? staleClearedByRoot[rootDirectory] ?? null : null;

  // Auto-select first non-hidden nested repo when rootDirectory is not a git repo
  useEffect(() => {
    if (!rootDirectory || rootIsGitRepo !== false) return;
    if (!rootNestedRepos || rootNestedRepos.length === 0) return;
    if (rootSelection) return;
    const candidates = staleClearedSelections
      ? rootNestedRepos.filter((repo) => !staleClearedSelections.has(repo))
      : rootNestedRepos;
    const autoPicked = chooseAutoNestedRepo(rootDirectory, candidates);
    if (!autoPicked) return;
    setSelectedNestedByRoot((prev) => ({
      ...prev,
      [rootDirectory]: { path: autoPicked, auto: true },
    }));
  }, [rootDirectory, rootIsGitRepo, rootNestedRepos, rootSelection, staleClearedSelections]);

  // Clear auto-selection if root itself becomes a git repo with commits
  useEffect(() => {
    if (!rootDirectory || !rootSelection?.auto) return;
    if (rootIsGitRepo !== true || rootStatus?.unborn) return;
    setSelectedNestedByRoot((prev) => {
      const next = { ...prev };
      delete next[rootDirectory];
      return next;
    });
  }, [rootDirectory, rootIsGitRepo, rootSelection, rootStatus?.unborn]);

  const effectiveDirectory = rootSelection?.path ?? rootDirectory;
  const status = statusState?.directory === effectiveDirectory ? statusState.data : null;
  const selectedIsGitRepo =
    effectiveDirectory && effectiveDirectory !== rootDirectory
      ? status?.isGitRepo ?? null
      : null;

  // Discover second-level nested repos when operating inside a selected nested repo
  useEffect(() => {
    if (!effectiveDirectory || effectiveDirectory === rootDirectory) {
      setCurrentNestedReposState(null);
      return;
    }
    if (selectedIsGitRepo === null) return;
    if (!discoversNestedRepos(effectiveDirectory, rootStatus?.homeDirectory)) return;
    let cancelled = false;
    serviceGet<GitDirectoriesResponse>('/git-dirs', { directory: effectiveDirectory })
      .then((res) => {
        if (cancelled) return;
        setCurrentNestedReposState({
          directory: effectiveDirectory,
          repos: res.repositories.map((r) => r.path),
        });
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveDirectory,
    lifecycleTick,
    refreshTick,
    rootDirectory,
    rootStatus?.homeDirectory,
    selectedIsGitRepo,
    serviceGet,
  ]);

  const currentNestedRepos =
    currentNestedReposState?.directory === effectiveDirectory
      ? currentNestedReposState.repos
      : null;

  const repositoryOptions = useMemo<string[] | null>(() => {
    if (!rootDirectory) return null;
    const discovered = rootNestedRepos && rootNestedRepos.length > 0 ? rootNestedRepos : null;
    const currentDiscovered =
      currentNestedRepos && currentNestedRepos.length > 0 ? currentNestedRepos : null;
    const selectedRepo =
      effectiveDirectory && effectiveDirectory !== rootDirectory ? effectiveDirectory : null;

    if (selectedRepo) {
      const options = [
        ...(rootIsGitRepo === true ? [rootDirectory] : []),
        ...(discovered ?? []),
        selectedRepo,
        ...(currentDiscovered ?? []),
      ];
      return [...new Set(options)];
    }
    if (discovered) {
      return rootIsGitRepo === true ? [rootDirectory, ...discovered] : discovered;
    }
    return null;
  }, [currentNestedRepos, effectiveDirectory, rootDirectory, rootIsGitRepo, rootNestedRepos]);

  const handleSelectRepository = useCallback(
    (repoPath: string) => {
      if (!rootDirectory) return;
      setSelectedNestedByRoot((prev) => {
        const next = { ...prev };
        if (repoPath === rootDirectory) {
          delete next[rootDirectory];
        } else {
          next[rootDirectory] = { path: repoPath, auto: false };
        }
        return next;
      });
    },
    [rootDirectory],
  );

  // Load status for effectiveDirectory
  useEffect(() => {
    if (!effectiveDirectory) {
      setStatusState(null);
      setStatusError(null);
      return;
    }
    if (effectiveDirectory === rootDirectory && rootStatus) {
      setStatusState({ directory: effectiveDirectory, data: rootStatus });
      setLoadingStatus(false);
      setStatusError(null);
      return;
    }

    let cancelled = false;
    setLoadingStatus(true);
    setStatusError(null);

    serviceGet<GitStatusResponse>('/status', { directory: effectiveDirectory })
      .then((next) => {
        if (cancelled) return;
        setStatusState({ directory: effectiveDirectory, data: next });
        setLoadingStatus(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatusError(err instanceof Error ? err.message : String(err));
        setLoadingStatus(false);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveDirectory, lifecycleTick, refreshTick, rootDirectory, rootStatus, serviceGet]);

  // Drop stale nested repository selection if that directory is no longer a git repository
  useEffect(() => {
    if (!rootDirectory || !effectiveDirectory || effectiveDirectory === rootDirectory) return;
    if (selectedIsGitRepo !== false) return;
    setStaleClearedByRoot((prev) => {
      const nextSet = new Set(prev[rootDirectory]);
      nextSet.add(effectiveDirectory);
      return { ...prev, [rootDirectory]: nextSet };
    });
    setSelectedNestedByRoot((prev) => {
      const next = { ...prev };
      delete next[rootDirectory];
      return next;
    });
    setRefreshTick((t) => t + 1);
  }, [effectiveDirectory, rootDirectory, selectedIsGitRepo]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const currentBranch = status?.current ?? null;
  const baseOverrideKey =
    effectiveDirectory && currentBranch ? `${effectiveDirectory}::${currentBranch}` : null;
  const chosenBase = baseOverrideKey ? baseOverrides[baseOverrideKey] ?? null : null;
  const currentBranchTarget: BranchTargetValue =
    (baseOverrideKey ? branchTargets[baseOverrideKey] : undefined) ?? { kind: 'working-tree' };

  // Fetch PRs for open-PR base detection and for PR scope
  const loadPullRequests = useCallback(() => {
    if (!effectiveDirectory || status?.isGitRepo === false) return;
    const targetDir = effectiveDirectory;
    const reqId = ++prsRequestSeqRef.current;
    setPrsLoading(true);
    setPrsError(null);
    serviceGet<{ available: boolean; prs: GitPullRequestEntry[]; error?: string }>('/prs', {
      directory: targetDir,
    })
      .then((res) => {
        if (prsRequestSeqRef.current !== reqId) return;
        setPrsState({
          directory: targetDir,
          prs: res.prs,
          available: res.available,
        });
        if (res.error && res.prs.length === 0) {
          setPrsError(res.error);
        }
        setPrsLoading(false);
        setSelectedPrNumber((prev) => {
          if (prev && res.prs.some((p) => p.number === prev)) return prev;
          const matchingBranchPr = currentBranch
            ? res.prs.find((p) => p.headRefName === currentBranch && p.state === 'open')
            : undefined;
          const firstOpen = res.prs.find((p) => p.state === 'open');
          return (matchingBranchPr ?? firstOpen ?? res.prs[0])?.number ?? null;
        });
      })
      .catch((err) => {
        if (prsRequestSeqRef.current !== reqId) return;
        setPrsError(err instanceof Error ? err.message : String(err));
        setPrsLoading(false);
      });
  }, [currentBranch, effectiveDirectory, serviceGet, status?.isGitRepo]);

  useEffect(() => {
    if (!effectiveDirectory || !status?.isGitRepo) return;
    loadPullRequests();
  }, [effectiveDirectory, lifecycleTick, loadPullRequests, refreshTick, status?.isGitRepo]);

  const prs = prsState?.directory === effectiveDirectory ? prsState.prs : [];
  const openPrForCurrentBranch = useMemo(
    () =>
      currentBranch
        ? prs.find((pr) => pr.headRefName === currentBranch && pr.state === 'open') ?? null
        : null,
    [currentBranch, prs],
  );

  const branchBaseResolution = useMemo(() => {
    if (!status || !currentBranch || currentBranch === 'HEAD') return null;
    const all = status.branches.all ?? [];
    const primaryRemote = status.branches.primaryRemote;
    return resolveBranchComparisonBase(
      {
        chosen: chosenBase,
        pullRequest: openPrForCurrentBranch?.baseRefName ?? null,
        createdFrom: status.createdFromBase,
        defaultBranch: primaryRemote ? status.branches.defaultBranches[primaryRemote] ?? null : null,
      },
      {
        localBranches: all.filter((name) => !name.startsWith('remotes/')),
        remoteBranches: all
          .filter((name) => name.startsWith('remotes/'))
          .map((name) => name.slice('remotes/'.length)),
        remoteNames: new Set(status.branches.remotes ?? []),
        primaryRemote,
        headBranch: currentBranch,
      },
    );
  }, [chosenBase, currentBranch, openPrForCurrentBranch?.baseRefName, status]);

  const qualifiedBranchBase = branchBaseResolution?.ref ?? null;
  const showBranchOption = isBranchScopeAvailable(currentBranch, qualifiedBranchBase);

  // Coerce scope when branch comparison is unavailable
  useEffect(() => {
    if (!status) return;
    if (!userPickedScope) {
      setActiveScope(showBranchOption ? 'branch' : 'working');
      return;
    }
    if (activeScope === 'branch' && !showBranchOption) {
      setActiveScope('working');
    }
  }, [activeScope, showBranchOption, status, userPickedScope]);

  const branchHeadRef =
    currentBranchTarget.kind === 'ref'
      ? currentBranchTarget.ref
      : currentBranch ?? 'HEAD';
  const branchIncludeWorkingTree = currentBranchTarget.kind === 'working-tree';

  const branchRangeKey =
    effectiveDirectory && qualifiedBranchBase && branchHeadRef && showBranchOption
      ? `${effectiveDirectory}::${qualifiedBranchBase}::${branchHeadRef}::${
          branchIncludeWorkingTree ? 'wt' : 'committed'
        }`
      : null;
  const branchFiles =
    branchRangeKey && branchFilesState?.key === branchRangeKey ? branchFilesState.files : null;

  // Fetch branch comparison files
  useEffect(() => {
    if (!effectiveDirectory || !qualifiedBranchBase || !branchHeadRef || !branchRangeKey) {
      setBranchFilesError(null);
      return;
    }
    let cancelled = false;
    setBranchFilesLoading(true);
    setBranchFilesError(null);

    serviceGet<{ files: GitRangeFile[] }>('/range-files', {
      directory: effectiveDirectory,
      base: qualifiedBranchBase,
      head: branchHeadRef,
      includeWorkingTree: branchIncludeWorkingTree ? 'true' : 'false',
    })
      .then((res) => {
        if (cancelled) return;
        setBranchFilesState({ key: branchRangeKey, files: res.files });
        setBranchFilesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setBranchFilesError(err instanceof Error ? err.message : String(err));
        setBranchFilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    branchHeadRef,
    branchIncludeWorkingTree,
    branchRangeKey,
    effectiveDirectory,
    lifecycleTick,
    qualifiedBranchBase,
    refreshTick,
    serviceGet,
  ]);

  const commits =
    commitsState?.directory === effectiveDirectory ? commitsState.commits : [];

  // Fetch commit log when in commit scope
  const loadCommits = useCallback(() => {
    if (!effectiveDirectory) return;
    const targetDir = effectiveDirectory;
    const reqId = ++commitsRequestSeqRef.current;
    setCommitsLoading(true);
    setCommitsError(null);
    const to = currentBranch && currentBranch !== 'HEAD' ? `refs/heads/${currentBranch}` : 'HEAD';
    serviceGet<{ all: GitLogEntry[] }>('/log', {
      directory: targetDir,
      maxCount: '50',
      to,
    })
      .then((res) => {
        if (commitsRequestSeqRef.current !== reqId) return;
        setCommitsState({ directory: targetDir, commits: res.all });
        setCommitsLoading(false);
        setSelectedCommitHash((prev) => {
          if (prev && res.all.some((c) => c.hash === prev)) return prev;
          return res.all[0]?.hash ?? null;
        });
      })
      .catch((err) => {
        if (commitsRequestSeqRef.current !== reqId) return;
        setCommitsError(err instanceof Error ? err.message : String(err));
        setCommitsLoading(false);
      });
  }, [currentBranch, effectiveDirectory, serviceGet]);

  useEffect(() => {
    if (activeScope === 'commit' && effectiveDirectory) {
      loadCommits();
    }
  }, [activeScope, effectiveDirectory, lifecycleTick, loadCommits, refreshTick]);

  const commitScopeKey =
    effectiveDirectory && selectedCommitHash
      ? `${effectiveDirectory}::${selectedCommitHash}`
      : null;
  const commitFiles =
    commitScopeKey && commitFilesState?.key === commitScopeKey ? commitFilesState.files : null;

  // Fetch files for selected commit
  useEffect(() => {
    if (activeScope !== 'commit' || !effectiveDirectory || !selectedCommitHash || !commitScopeKey) {
      setCommitFilesError(null);
      return;
    }
    let cancelled = false;
    setCommitFilesLoading(true);
    setCommitFilesError(null);

    serviceGet<{ files: GitCommitFile[] }>('/commit-files', {
      directory: effectiveDirectory,
      hash: selectedCommitHash,
    })
      .then((res) => {
        if (cancelled) return;
        setCommitFilesState({ key: commitScopeKey, files: res.files });
        setCommitFilesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setCommitFilesError(err instanceof Error ? err.message : String(err));
        setCommitFilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeScope, commitScopeKey, effectiveDirectory, selectedCommitHash, serviceGet]);

  const prRangeLookupKey =
    effectiveDirectory && selectedPrNumber ? `${effectiveDirectory}::pr:${selectedPrNumber}` : null;
  const activePrCommitRange: PrCommitRangeValue = prRangeLookupKey
    ? prCommitRanges[prRangeLookupKey] ?? null
    : null;
  const prScopeKey = prRangeLookupKey
    ? `${prRangeLookupKey}::${
        activePrCommitRange
          ? `${activePrCommitRange.fromOid}..${activePrCommitRange.toOid}`
          : 'all'
      }`
    : null;
  const activePrFilesState =
    prScopeKey && prFilesState?.key === prScopeKey ? prFilesState : null;
  const currentPrMetaState =
    prRangeLookupKey && prFilesState?.prLookupKey === prRangeLookupKey ? prFilesState : null;
  const prFiles = activePrFilesState?.files ?? null;
  const prCommits = currentPrMetaState?.commits ?? [];
  const pullRequestNodeId = currentPrMetaState?.pullRequestNodeId ?? null;

  // Fetch files for selected PR (and optional commit range)
  useEffect(() => {
    if (
      activeScope !== 'pr' ||
      !effectiveDirectory ||
      !selectedPrNumber ||
      !prScopeKey ||
      !prRangeLookupKey
    ) {
      setPrFilesError(null);
      return;
    }
    let cancelled = false;
    setPrFilesLoading(true);
    setPrFilesError(null);

    const query: Record<string, string> = {
      directory: effectiveDirectory,
      number: String(selectedPrNumber),
    };
    if (activePrCommitRange) {
      query.fromCommit = activePrCommitRange.fromOid;
      query.toCommit = activePrCommitRange.toOid;
    }

    serviceGet<{
      pullRequestNodeId: string | null;
      files: GitPullRequestFile[];
      commits: GitPullRequestCommit[];
      baseRefOid: string;
      headRefOid: string;
    }>('/pr-files', query)
      .then((res) => {
        if (cancelled) return;
        setViewedOverrides((prev) => {
          const prefix = `${prRangeLookupKey}::`;
          let changed = false;
          const next: Record<string, PrFileViewedState> = {};
          for (const [k, v] of Object.entries(prev)) {
            if (k.startsWith(prefix)) {
              changed = true;
            } else {
              next[k] = v;
            }
          }
          return changed ? next : prev;
        });
        setPrFilesState({
          key: prScopeKey,
          prLookupKey: prRangeLookupKey,
          pullRequestNodeId: res.pullRequestNodeId ?? null,
          files: res.files,
          commits: res.commits ?? [],
          baseRefOid: res.baseRefOid,
          headRefOid: res.headRefOid,
        });
        setPrFilesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setPrFilesError(err instanceof Error ? err.message : String(err));
        setPrFilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activePrCommitRange,
    activeScope,
    effectiveDirectory,
    prRangeLookupKey,
    prScopeKey,
    refreshTick,
    selectedPrNumber,
    serviceGet,
  ]);

  const workingFileCount = useMemo(
    () => (status?.files ? status.files.filter(isWorkingStatusFile).length : 0),
    [status],
  );

  const stagedFileCount = useMemo(
    () => (status?.files ? status.files.filter(isStagedStatusFile).length : 0),
    [status],
  );

  const changedFiles = useMemo<FileEntry[]>(() => {
    if (activeScope === 'pr') {
      return (prFiles ?? []).map((f) => {
        const overrideKey = prRangeLookupKey ? `${prRangeLookupKey}::${f.path}` : null;
        const viewedState =
          (overrideKey ? viewedOverrides[overrideKey] : undefined) ?? f.viewedState;
        return {
          path: f.path,
          previousPath: f.previousPath,
          index: '',
          working_dir: f.status,
          insertions: f.insertions,
          deletions: f.deletions,
          isNew: f.status === 'A',
          viewedState,
        };
      });
    }
    if (activeScope === 'commit') {
      return (commitFiles ?? []).map((f) => ({
        path: f.path,
        previousPath: f.previousPath,
        index: '',
        working_dir: f.status,
        insertions: f.insertions,
        deletions: f.deletions,
        isNew: f.status === 'A',
      }));
    }
    if (activeScope === 'branch') {
      return (branchFiles ?? [])
        .map((f) => ({
          path: f.path,
          previousPath: f.previousPath,
          index: '',
          working_dir: f.status,
          insertions: f.insertions,
          deletions: f.deletions,
          isNew: f.status === 'A',
          revision: f.revision,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    }
    if (!status?.files) return [];
    const include = activeScope === 'staged' ? isStagedStatusFile : isWorkingStatusFile;
    return status.files
      .filter(include)
      .map((f) => {
        const stats =
          activeScope === 'staged'
            ? status.diffStats.staged[f.path]
            : status.diffStats.working[f.path];
        const isRenamedInScope =
          activeScope === 'staged'
            ? f.index === 'R' || f.index === 'C'
            : f.working_dir === 'R' || f.working_dir === 'C';
        return {
          ...f,
          previousPath: isRenamedInScope ? f.previousPath : undefined,
          insertions: stats?.insertions ?? 0,
          deletions: stats?.deletions ?? 0,
          isNew: isNewStatusFile(f, activeScope),
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [activeScope, branchFiles, commitFiles, prFiles, prRangeLookupKey, status, viewedOverrides]);

  const filesSettled =
    activeScope === 'pr'
      ? prFiles !== null
      : activeScope === 'commit'
        ? commitFiles !== null
        : activeScope === 'branch'
          ? branchFiles !== null
          : status !== null;

  const changedPathsKey = useMemo(
    () => changedFiles.map((f) => f.path).join('\0'),
    [changedFiles],
  );

  useEffect(() => {
    if (!filesSettled) return;
    const paths = changedPathsKey ? changedPathsKey.split('\0') : [];
    const pathSet = new Set(paths);
    const scopeKey = `${effectiveDirectory ?? ''}:${activeScope}:${
      activeScope === 'branch'
        ? `${qualifiedBranchBase ?? ''}:${branchHeadRef}:${branchIncludeWorkingTree}`
        : ''
    }:${activeScope === 'commit' ? selectedCommitHash ?? '' : ''}:${
      activeScope === 'pr'
        ? `${selectedPrNumber ?? ''}:${
            activePrCommitRange
              ? `${activePrCommitRange.fromOid}..${activePrCommitRange.toOid}`
              : 'all'
          }`
        : ''
    }`;
    const shouldInit = stackedScopeRef.current !== scopeKey;
    stackedScopeRef.current = scopeKey;

    setExpandedFiles((prev) => {
      if (shouldInit) {
        // In PR scope, files already marked VIEWED start collapsed by default
        const unviewedPaths =
          activeScope === 'pr'
            ? changedFiles.filter((f) => f.viewedState !== 'VIEWED').map((f) => f.path)
            : paths;
        const count = getStackedViewDefaultExpandedCount(unviewedPaths.length);
        return new Set(unviewedPaths.slice(0, count));
      }
      const next = new Set<string>();
      for (const p of prev) {
        if (pathSet.has(p)) next.add(p);
      }
      return next;
    });

    setMountedStackedFiles((prev) => {
      if (shouldInit) return new Set();
      const next = new Set<string>();
      for (const p of prev) {
        if (pathSet.has(p)) next.add(p);
      }
      return next;
    });
  }, [
    activePrCommitRange,
    activeScope,
    branchHeadRef,
    branchIncludeWorkingTree,
    changedFiles,
    changedPathsKey,
    effectiveDirectory,
    filesSettled,
    qualifiedBranchBase,
    selectedCommitHash,
    selectedPrNumber,
  ]);

  const syncVisibleStackedFiles = useCallback(() => {
    const scrollRoot = diffScrollRef.current;
    if (!scrollRoot) return;
    const rootRect = scrollRoot.getBoundingClientRect();
    const top = rootRect.top - STACKED_DIFF_MOUNT_MARGIN;
    const bottom = rootRect.bottom + STACKED_DIFF_MOUNT_MARGIN;
    const nextMounted: string[] = [];

    for (const [path, node] of fileSectionRefs.current) {
      if (!node || !expandedFiles.has(path)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.bottom < top || rect.top > bottom) continue;
      nextMounted.push(path);
    }

    setMountedStackedFiles((prev) => {
      let changed = false;
      const copy = new Set(prev);
      for (const p of nextMounted) {
        if (!copy.has(p)) {
          copy.add(p);
          changed = true;
        }
      }
      return changed ? copy : prev;
    });
  }, [expandedFiles]);

  useEffect(() => {
    const scrollRoot = diffScrollRef.current;
    if (!scrollRoot) return;
    const frame = requestAnimationFrame(syncVisibleStackedFiles);
    scrollRoot.addEventListener('scroll', syncVisibleStackedFiles, { passive: true });
    window.addEventListener('resize', syncVisibleStackedFiles);
    return () => {
      cancelAnimationFrame(frame);
      scrollRoot.removeEventListener('scroll', syncVisibleStackedFiles);
      window.removeEventListener('resize', syncVisibleStackedFiles);
    };
  }, [changedFiles, expandedFiles, syncVisibleStackedFiles]);

  const registerSectionRef = useCallback(
    (path: string, node: HTMLDivElement | null) => {
      if (node) fileSectionRefs.current.set(path, node);
      else fileSectionRefs.current.delete(path);
      requestAnimationFrame(syncVisibleStackedFiles);
    },
    [syncVisibleStackedFiles],
  );

  const registerViewerRef = useCallback((path: string, handle: PierreDiffViewerHandle | null) => {
    if (handle) viewerRefs.current.set(path, handle);
    else viewerRefs.current.delete(path);
  }, []);

  const handleDiffLoaded = useCallback((path: string, fileDiff: FileDiffMetadata | null) => {
    const map = loadedDiffsRef.current;
    const previous = map.get(path) ?? null;
    if (previous === fileDiff) return;
    if (fileDiff) map.set(path, fileDiff);
    else map.delete(path);
    setLoadedDiffsVersion((v) => v + 1);
  }, []);

  const getLayoutForFile = useCallback(
    (file: FileEntry): 'inline' | 'side-by-side' => {
      const override = perFileLayout[file.path];
      if (override) return override;
      if (globalLayout) return globalLayout;
      if (file.isNew || viewportWidth < SIDE_BY_SIDE_MIN_WIDTH) return 'inline';
      return 'side-by-side';
    },
    [globalLayout, perFileLayout, viewportWidth],
  );

  const currentLayoutForAllFiles = useMemo<'inline' | 'side-by-side' | null>(() => {
    if (changedFiles.length === 0) return null;
    return changedFiles.every((f) => getLayoutForFile(f) === 'side-by-side')
      ? 'side-by-side'
      : 'inline';
  }, [changedFiles, getLayoutForFile]);

  const fetchFileDiff = useCallback(
    async (file: FileEntry): Promise<ServiceFileDiffResponse> => {
      if (!effectiveDirectory) throw new Error('No project directory');
      const query: Record<string, string> = {
        directory: effectiveDirectory,
        scope: activeScope,
        path: file.path,
        ignoreComments: ignoreComments ? 'true' : 'false',
      };
      if (file.previousPath) query.previousPath = file.previousPath;
      if (activeScope === 'branch' && qualifiedBranchBase && branchHeadRef) {
        query.base = qualifiedBranchBase;
        query.head = branchHeadRef;
        query.includeWorkingTree = branchIncludeWorkingTree ? 'true' : 'false';
      }
      if (activeScope === 'commit' && selectedCommitHash) {
        query.hash = selectedCommitHash;
      }
      if (activeScope === 'pr' && activePrFilesState) {
        query.base = activePrFilesState.baseRefOid;
        query.head = activePrFilesState.headRefOid;
      }
      return serviceGet<ServiceFileDiffResponse>('/file-diff', query);
    },
    [
      activePrFilesState,
      activeScope,
      branchHeadRef,
      branchIncludeWorkingTree,
      effectiveDirectory,
      ignoreComments,
      qualifiedBranchBase,
      selectedCommitHash,
      serviceGet,
    ],
  );

  const isTreeMode = fileListMode === 'tree';
  const showFileSidebar = !isTreeMode && viewportWidth >= 1024;

  const treeFileOrder = useMemo(
    () =>
      isTreeMode
        ? buildDiffTreeRows(changedFiles, new Set()).flatMap((row) =>
            row.kind === 'file' ? [row.file] : [],
          )
        : [],
    [changedFiles, isTreeMode],
  );

  const treeSelectedFile = isTreeMode
    ? treeFileOrder.find((f) => f.path === displayFile) ?? treeFileOrder[0] ?? null
    : null;

  useEffect(() => {
    if (treeSelectedFile && !expandedFiles.has(treeSelectedFile.path)) {
      setExpandedFiles((prev) => new Set(prev).add(treeSelectedFile.path));
    }
  }, [expandedFiles, treeSelectedFile]);

  const scrollToFile = useCallback((path: string) => {
    const node = fileSectionRefs.current.get(path);
    const scrollRoot = diffScrollRef.current;
    if (!node || !scrollRoot) return;
    const offset = node.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top;
    scrollRoot.scrollTo({ top: scrollRoot.scrollTop + offset, behavior: 'auto' });
  }, []);

  const handleSelectFile = useCallback(
    (path: string) => {
      setDisplayFile(path);
      setExpandedFiles((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
      if (isTreeMode) {
        diffScrollRef.current?.scrollTo({ top: 0 });
      } else {
        requestAnimationFrame(() => scrollToFile(path));
      }
    },
    [isTreeMode, scrollToFile],
  );

  const handleExpandedChange = useCallback((path: string, expanded: boolean) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const handleToggleFileViewed = useCallback(
    (filePath: string, nextViewed: boolean) => {
      if (!effectiveDirectory || !prRangeLookupKey || !pullRequestNodeId) return;
      const overrideKey = `${prRangeLookupKey}::${filePath}`;
      const previousFile = changedFiles.find((f) => f.path === filePath);
      const previousState: PrFileViewedState = previousFile?.viewedState ?? 'UNVIEWED';
      const nextState: PrFileViewedState = nextViewed ? 'VIEWED' : 'UNVIEWED';

      setViewedOverrides((prev) => ({ ...prev, [overrideKey]: nextState }));
      if (nextViewed) {
        handleExpandedChange(filePath, false);
      }

      void host
        .serviceRequest({
          method: 'POST',
          path: '/pr-file-viewed',
          body: JSON.stringify({
            directory: effectiveDirectory,
            pullRequestNodeId,
            path: filePath,
            viewed: nextViewed,
          }),
        })
        .then((res) => {
          if (res.status < 200 || res.status >= 300) {
            const parsed = JSON.parse(res.body) as { message?: string; error?: string };
            throw new Error(parsed.message || parsed.error || `HTTP ${res.status}`);
          }
        })
        .catch((err) => {
          setViewedOverrides((prev) => ({ ...prev, [overrideKey]: previousState }));
          void host.toast({
            kind: 'error',
            message:
              err instanceof Error ? err.message : 'Failed to update GitHub file viewed state',
          });
        });
    },
    [changedFiles, effectiveDirectory, handleExpandedChange, host, prRangeLookupKey, pullRequestNodeId],
  );

  const handleExpandOrCollapseAll = useCallback(() => {
    setExpandedFiles((prev) =>
      prev.size > 0 ? new Set() : new Set(changedFiles.map((f) => f.path)),
    );
  }, [changedFiles]);

  // Tree resize
  const handleTreeResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = fileTreeWidth;
      const maxW = Math.max(
        FILE_TREE_MIN_WIDTH,
        (fileTreeLayoutRef.current?.clientWidth ?? 600) * FILE_TREE_MAX_FRACTION,
      );
      const onMove = (moveEvent: PointerEvent) => {
        const next = Math.min(
          maxW,
          Math.max(FILE_TREE_MIN_WIDTH, startWidth + (moveEvent.clientX - startX)),
        );
        setFileTreeWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [fileTreeWidth],
  );

  // Keyboard shortcuts: Cmd/Ctrl+F for Find, Alt+ArrowUp/Down for file navigation
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
        return;
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const navFiles = isTreeMode ? treeFileOrder : changedFiles;
        if (navFiles.length === 0) return;
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const cur = isTreeMode ? treeSelectedFile?.path : displayFile;
        const idx = cur ? navFiles.findIndex((f) => f.path === cur) : -1;
        const nextIdx = idx === -1 ? (delta > 0 ? 0 : navFiles.length - 1) : idx + delta;
        const next = navFiles[nextIdx];
        if (next) handleSelectFile(next.path);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changedFiles, displayFile, handleSelectFile, isTreeMode, treeFileOrder, treeSelectedFile]);

  const requestKeyPrefix = `${effectiveDirectory ?? ''}::${activeScope}::${qualifiedBranchBase ?? ''}::${branchHeadRef}::${
    branchIncludeWorkingTree ? 'wt' : 'committed'
  }::${selectedCommitHash ?? ''}::${selectedPrNumber ?? ''}::${
    activePrCommitRange
      ? `${activePrCommitRange.fromOid}..${activePrCommitRange.toOid}`
      : 'all'
  }::${ignoreComments ? 'no-comments' : 'comments'}::${refreshTick}::${lifecycleTick}`;

  useEffect(() => {
    loadedDiffsRef.current.clear();
    setLoadedDiffsVersion((v) => v + 1);
  }, [requestKeyPrefix]);

  // Find matches calculation
  const findMatches = useMemo<FindMatch[]>(() => {
    void loadedDiffsVersion;
    if (!findOpen || !findQuery.trim()) return [];
    const results: FindMatch[] = [];
    const targetFiles = isTreeMode ? (treeSelectedFile ? [treeSelectedFile] : []) : changedFiles;
    for (const file of targetFiles) {
      const fd = loadedDiffsRef.current.get(file.path);
      if (fd) {
        results.push(...searchFileDiff(file.path, fd, findQuery.trim()));
      }
    }
    return results;
  }, [changedFiles, findOpen, findQuery, isTreeMode, loadedDiffsVersion, treeSelectedFile]);

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery]);

  useEffect(() => {
    const activeMatch = findMatches[findIndex];
    for (const [path, viewer] of viewerRefs.current) {
      const fileMatches = findMatches.filter((m) => m.filePath === path);
      const localCurrent =
        activeMatch && activeMatch.filePath === path ? fileMatches.indexOf(activeMatch) : -1;
      viewer.setFindHighlights(fileMatches, localCurrent);
    }
    if (activeMatch) {
      const viewer = viewerRefs.current.get(activeMatch.filePath);
      viewer?.scrollToLine({
        lineNumber: activeMatch.lineNumber,
        side: activeMatch.side,
        align: 'center',
      });
    }
  }, [findIndex, findMatches]);

  const selectedPr = prs.find((p) => p.number === selectedPrNumber) ?? null;

  const renderBody = () => {
    if (!effectiveDirectory) {
      return (
        <div className="oc-diff-empty">Select a project or session directory to view diffs.</div>
      );
    }
    if (loadingStatus && !status) {
      return (
        <div className="oc-diff-empty">
          <Icon name="loader-4" className="oc-icon oc-spin" />
          <span>Loading repository status…</span>
        </div>
      );
    }
    if (statusError && !status) {
      return (
        <div className="oc-diff-empty oc-diff-empty--col">
          <div className="oc-diff-empty-title">Could not load repository status</div>
          <div className="oc-diff-empty-desc">{statusError}</div>
          <button
            type="button"
            className="oc-link-btn"
            onClick={() => setRefreshTick((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      );
    }
    if (status && !status.isGitRepo) {
      return <div className="oc-diff-empty">Current directory is not a Git repository.</div>;
    }
    if (activeScope === 'branch') {
      if (branchFilesLoading && !branchFiles) {
        return (
          <div className="oc-diff-empty">
            <Icon name="loader-4" className="oc-icon oc-spin" />
            <span>Loading branch changes…</span>
          </div>
        );
      }
      if (branchFilesError) {
        return (
          <div className="oc-diff-empty oc-diff-empty--col">
            <div className="oc-diff-empty-title">Failed to load branch comparison</div>
            <div className="oc-diff-empty-desc">{branchFilesError}</div>
            <button
              type="button"
              className="oc-link-btn"
              onClick={() => setRefreshTick((t) => t + 1)}
            >
              Retry
            </button>
          </div>
        );
      }
    }
    if (activeScope === 'commit') {
      if ((commitsLoading || commitFilesLoading) && !commitFiles) {
        return (
          <div className="oc-diff-empty">
            <Icon name="loader-4" className="oc-icon oc-spin" />
            <span>Loading commit diff…</span>
          </div>
        );
      }
      if (commitFilesError) {
        return (
          <div className="oc-diff-empty oc-diff-empty--col">
            <div className="oc-diff-empty-title">Failed to load commit diff</div>
            <div className="oc-diff-empty-desc">{commitFilesError}</div>
            <button
              type="button"
              className="oc-link-btn"
              onClick={() => setRefreshTick((t) => t + 1)}
            >
              Retry
            </button>
          </div>
        );
      }
    }
    if (activeScope === 'pr') {
      if ((prsLoading || prFilesLoading) && !prFiles) {
        return (
          <div className="oc-diff-empty">
            <Icon name="loader-4" className="oc-icon oc-spin" />
            <span>Loading pull request diff…</span>
          </div>
        );
      }
      if (prFilesError || (prsError && prs.length === 0)) {
        return (
          <div className="oc-diff-empty oc-diff-empty--col">
            <div className="oc-diff-empty-title">Failed to load pull request diff</div>
            <div className="oc-diff-empty-desc">{prFilesError ?? prsError}</div>
            <button
              type="button"
              className="oc-link-btn"
              onClick={() => {
                loadPullRequests();
                setRefreshTick((t) => t + 1);
              }}
            >
              Retry
            </button>
          </div>
        );
      }
      if (!selectedPrNumber && !prsLoading) {
        return <div className="oc-diff-empty">No pull requests found for this repository.</div>;
      }
    }
    if (!filesSettled) {
      return (
        <div className="oc-diff-empty">
          <Icon name="loader-4" className="oc-icon oc-spin" />
          <span>Loading changes…</span>
        </div>
      );
    }
    if (changedFiles.length === 0) {
      return (
        <div className="oc-diff-empty">
          {activeScope === 'pr'
            ? 'No changed files in this pull request.'
            : activeScope === 'commit'
              ? 'No changed files in this commit.'
              : activeScope === 'branch' && qualifiedBranchBase
                ? `No changes compared to ${branchRefLabel(qualifiedBranchBase)}.`
                : activeScope === 'staged'
                  ? 'No staged changes.'
                  : 'Working tree is clean.'}
        </div>
      );
    }

    const renderEntry = (file: FileEntry, singleFile = false) => {
      const isExpanded = singleFile || expandedFiles.has(file.path);
      const isMounted = singleFile || mountedStackedFiles.has(file.path);
      return (
        <MultiFileDiffEntry
          key={`${file.path}:${activeScope}`}
          visible={isExpanded}
          directory={effectiveDirectory}
          file={file}
          scope={activeScope}
          layout={getLayoutForFile(file)}
          wrapLines={wrapLines}
          ignoreComments={ignoreComments}
          themeId={themeId}
          isDark={isDark}
          isExpanded={isExpanded}
          isMounted={isMounted}
          revision={refreshTick + lifecycleTick}
          onExpandedChange={handleExpandedChange}
          onLayoutChange={(path, nextLayout) =>
            setPerFileLayout((prev) => ({ ...prev, [path]: nextLayout }))
          }
          registerSectionRef={registerSectionRef}
          registerViewerRef={registerViewerRef}
          fetchFileDiff={fetchFileDiff}
          serviceGet={serviceGet}
          onSelectRepository={handleSelectRepository}
          onToggleViewed={
            activeScope === 'pr' && pullRequestNodeId ? handleToggleFileViewed : undefined
          }
          requestKeyPrefix={requestKeyPrefix}
          onDiffLoaded={handleDiffLoaded}
        />
      );
    };

    return (
      <div ref={fileTreeLayoutRef} className="oc-diff-layout">
        {isTreeMode ? (
          <>
            <section className="oc-tree-sidebar" style={{ width: `${fileTreeWidth}px` }}>
              <FileTree
                changedFiles={changedFiles}
                scope={activeScope}
                selectedFile={treeSelectedFile?.path ?? null}
                onSelectFile={handleSelectFile}
              />
            </section>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize file tree"
              onPointerDown={handleTreeResizeStart}
              className="oc-tree-resizer"
            />
          </>
        ) : null}
        {showFileSidebar ? (
          <section className="oc-flat-sidebar">
            <div className="oc-flat-sidebar-header">
              <span>Files</span>
              <span className="oc-flat-sidebar-count">{changedFiles.length}</span>
            </div>
            <FileList
              changedFiles={changedFiles}
              scope={activeScope}
              selectedFile={displayFile}
              onSelectFile={handleSelectFile}
            />
          </section>
        ) : null}
        <div className="oc-diff-main">
          {findOpen ? (
            <div className="oc-find-bar">
              <Icon name="search" className="oc-icon-sm oc-muted-icon" />
              <input
                ref={findInputRef}
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && findMatches.length > 0) {
                    e.preventDefault();
                    setFindIndex((prev) =>
                      e.shiftKey
                        ? (prev - 1 + findMatches.length) % findMatches.length
                        : (prev + 1) % findMatches.length,
                    );
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setFindOpen(false);
                    setFindQuery('');
                  }
                }}
                placeholder="Find in loaded diffs…"
                className="oc-find-input"
              />
              <span className="oc-find-count">
                {findQuery.trim()
                  ? `${findMatches.length > 0 ? findIndex + 1 : 0}/${findMatches.length}`
                  : ''}
              </span>
              <ToolbarIconButton
                label="Previous match"
                icon="arrow-up-s"
                disabled={findMatches.length === 0}
                onClick={() =>
                  setFindIndex((prev) => (prev - 1 + findMatches.length) % findMatches.length)
                }
              />
              <ToolbarIconButton
                label="Next match"
                icon="arrow-down-s"
                disabled={findMatches.length === 0}
                onClick={() => setFindIndex((prev) => (prev + 1) % findMatches.length)}
              />
              <ToolbarIconButton
                label="Close find"
                icon="close"
                onClick={() => {
                  setFindOpen(false);
                  setFindQuery('');
                }}
              />
            </div>
          ) : null}
          <div ref={diffScrollRef} className="oc-diff-scroll" data-diff-virtual-root>
            <div className="oc-diff-scroll-content" data-diff-virtual-content>
              {isTreeMode
                ? treeSelectedFile && renderEntry(treeSelectedFile, true)
                : changedFiles.map((f) => renderEntry(f))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="oc-diff-view">
      <div className="oc-diff-toolbar">
        {repositoryOptions && repositoryOptions.length > 0 ? (
          <NestedRepoPicker
            repositories={repositoryOptions}
            selectedRepository={effectiveDirectory}
            onSelectRepository={handleSelectRepository}
            repositoryRoot={rootDirectory}
          />
        ) : null}
        <ChangeScopeSelector
          scope={activeScope}
          workingCount={workingFileCount}
          stagedCount={stagedFileCount}
          branchCount={branchFiles?.length ?? null}
          commitCount={activeScope === 'commit' ? commitFiles?.length ?? null : null}
          prCount={activeScope === 'pr' ? prFiles?.length ?? null : null}
          showBranchOption={showBranchOption}
          onScopeChange={(nextScope) => {
            setUserPickedScope(true);
            setActiveScope(nextScope);
          }}
        />
        {activeScope === 'branch' ? (
          <>
            <BranchComparisonSelector
              branches={status?.branches.all ?? []}
              currentBranch={currentBranch}
              base={qualifiedBranchBase}
              automatic={branchBaseResolution?.source !== 'chosen'}
              onSelect={(baseRef) => {
                if (baseOverrideKey) {
                  setBaseOverrides((prev) => ({ ...prev, [baseOverrideKey]: baseRef }));
                }
              }}
              onSelectAutomatic={() => {
                if (baseOverrideKey) {
                  setBaseOverrides((prev) => {
                    const next = { ...prev };
                    delete next[baseOverrideKey];
                    return next;
                  });
                }
              }}
            />
            <BranchTargetSelector
              branches={status?.branches.all ?? []}
              currentBranch={currentBranch}
              base={qualifiedBranchBase}
              target={currentBranchTarget}
              onSelect={(nextTarget) => {
                if (baseOverrideKey) {
                  setBranchTargets((prev) => ({ ...prev, [baseOverrideKey]: nextTarget }));
                }
              }}
            />
          </>
        ) : null}
        {activeScope === 'commit' ? (
          <>
            <CommitComparisonSelector
              commits={commits}
              selectedHash={selectedCommitHash}
              loading={commitsLoading}
              error={commitsError}
              onSelect={(commit) => setSelectedCommitHash(commit.hash)}
              onRefresh={loadCommits}
            />
            {selectedCommitHash ? (
              <ToolbarIconButton
                label="Open commit in host Diff view"
                icon="external-link"
                onClick={() => {
                  void host.openCommit(selectedCommitHash).catch((err) => {
                    void host.toast({
                      kind: 'error',
                      message: err instanceof Error ? err.message : 'Could not open commit',
                    });
                  });
                }}
              />
            ) : null}
          </>
        ) : null}
        {activeScope === 'pr' ? (
          <>
            <PullRequestComparisonSelector
              prs={prs}
              selectedNumber={selectedPrNumber}
              loading={prsLoading}
              error={prsError}
              onSelect={(pr) => setSelectedPrNumber(pr.number)}
              onRefresh={loadPullRequests}
            />
            {prCommits.length > 0 ? (
              <PullRequestCommitRangeSelector
                commits={prCommits}
                range={activePrCommitRange}
                onSelectRange={(nextRange) => {
                  if (!prRangeLookupKey) return;
                  setPrCommitRanges((prev) => {
                    const next = { ...prev };
                    if (nextRange === null) delete next[prRangeLookupKey];
                    else next[prRangeLookupKey] = nextRange;
                    return next;
                  });
                }}
              />
            ) : null}
            {selectedPr?.url ? (
              <ToolbarIconButton
                label="Open pull request in browser"
                icon="external-link"
                onClick={() => {
                  void host.openUrl(selectedPr.url);
                }}
              />
            ) : null}
          </>
        ) : null}
        {status && !status.difftAvailable ? (
          <span
            className="oc-difft-warning"
            title="Install difftastic (`difft`) on PATH for structural AST diffs"
          >
            difft not found (using line fallback)
          </span>
        ) : null}
        <div className="oc-toolbar-spacer" />
        {changedFiles.length > 0 && !isTreeMode ? (
          <button
            type="button"
            className="oc-toolbar-text-btn"
            onClick={handleExpandOrCollapseAll}
            title={expandedFiles.size > 0 ? 'Collapse all' : 'Expand all'}
          >
            <Icon name="expand-up-down" className="oc-icon" />
            <span className="oc-toolbar-text-btn-label">
              {expandedFiles.size > 0 ? 'Collapse all' : 'Expand all'}
            </span>
          </button>
        ) : null}
        {changedFiles.length > 0 ? (
          <>
            <ToolbarIconButton
              label="Find in diffs (Cmd/Ctrl+F)"
              icon="search"
              pressed={findOpen}
              onClick={() => {
                setFindOpen((prev) => {
                  const next = !prev;
                  if (!next) setFindQuery('');
                  else requestAnimationFrame(() => findInputRef.current?.focus());
                  return next;
                });
              }}
            />
            <ToolbarIconButton
              label="Ignore comments in structural diff"
              icon="chat-off"
              pressed={ignoreComments}
              onClick={() => setIgnoreComments((prev) => !prev)}
            />
            <ToolbarIconButton
              label="Show files as tree"
              icon="node-tree"
              pressed={fileListMode === 'tree'}
              onClick={() => setFileListMode((prev) => (prev === 'tree' ? 'flat' : 'tree'))}
            />
            <ToolbarIconButton
              label="Wrap lines"
              icon="text-wrap"
              pressed={wrapLines}
              onClick={() => setWrapLines((prev) => !prev)}
            />
          </>
        ) : null}
        {currentLayoutForAllFiles ? (
          <DiffViewToggle
            mode={currentLayoutForAllFiles === 'side-by-side' ? 'side-by-side' : 'unified'}
            onModeChange={(mode: DiffViewMode) => {
              setPerFileLayout({});
              setGlobalLayout(mode === 'side-by-side' ? 'side-by-side' : 'inline');
            }}
          />
        ) : null}
        <ToolbarIconButton
          label="Refresh diffs"
          icon="refresh"
          onClick={() => setRefreshTick((t) => t + 1)}
        />
      </div>
      {renderBody()}
    </div>
  );
};
