import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { HostClient, HostReadyContext } from '@openchamber/sdk';
import type { FileDiffMetadata } from '@pierre/diffs';
import { Icon } from './icons';
import {
  ChangeScopeSelector,
  BranchComparisonSelector,
  CommitComparisonSelector,
  DiffViewToggle,
  ToolbarIconButton,
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
import { ensureHostPierreThemeRegistered } from './pierreTheme';
import type {
  DiffData,
  DiffScope,
  DiffViewMode,
  FileEntry,
  GitCommitFile,
  GitLogEntry,
  GitRangeFile,
  GitStatusResponse,
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
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  className={`oc-file-row ${isActive ? 'oc-file-row--active' : ''}`}
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
            return (
              <li key={row.key} className="oc-tree-li">
                <button
                  type="button"
                  onClick={() => onSelectFile(row.file.path)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`oc-tree-row ${isActive ? 'oc-tree-row--active' : ''}`}
                  style={{ paddingInlineStart: `${paddingLeft}px` }}
                  title={row.file.path}
                >
                  <Icon name="file-code" className="oc-icon-sm oc-shrink-0" />
                  <span className="oc-tree-row-name">{row.name}</span>
                  <span className="oc-tree-row-end">
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
  file: FileEntry;
  scope: DiffScope;
  layout: 'inline' | 'side-by-side';
  wrapLines: boolean;
  themeId: string;
  isDark: boolean;
  isExpanded: boolean;
  isMounted: boolean;
  onExpandedChange: (path: string, expanded: boolean) => void;
  onLayoutChange: (path: string, layout: 'inline' | 'side-by-side') => void;
  registerSectionRef: (path: string, node: HTMLDivElement | null) => void;
  registerViewerRef: (path: string, handle: PierreDiffViewerHandle | null) => void;
  fetchFileDiff: (file: FileEntry) => Promise<ServiceFileDiffResponse>;
  requestKeyPrefix: string;
  onDiffLoaded?: (path: string, fileDiff: FileDiffMetadata | null) => void;
}

const MultiFileDiffEntry = React.memo<MultiFileDiffEntryProps>(
  ({
    visible,
    file,
    scope,
    layout,
    wrapLines,
    themeId,
    isDark,
    isExpanded,
    isMounted,
    onExpandedChange,
    onLayoutChange,
    registerSectionRef,
    registerViewerRef,
    fetchFileDiff,
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
      if (!currentResponse || error) return null;
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
      if (!diffData || !isExpanded || !isMounted) return null;
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
      !diffData.isBinary &&
      !diffData.isImage &&
      !forceLineDiff &&
      (diffData.fileDiff?.hunks.length ?? 0) === 0;

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
            {isMounted && loading && !diffData && !error ? (
              <div className="oc-diff-entry-status">
                <Icon name="loader-4" className="oc-icon oc-spin" />
                <span>Loading structural diff…</span>
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
            {isMounted &&
            diffData &&
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
  directory,
  lifecycleTick,
}) => {
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

  const [branchFilesState, setBranchFilesState] = useState<{
    key: string;
    files: GitRangeFile[];
  } | null>(null);
  const [branchFilesLoading, setBranchFilesLoading] = useState(false);
  const [branchFilesError, setBranchFilesError] = useState<string | null>(null);

  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitFilesState, setCommitFilesState] = useState<{
    key: string;
    files: GitCommitFile[];
  } | null>(null);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [commitFilesError, setCommitFilesError] = useState<string | null>(null);

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

  const status = statusState?.directory === directory ? statusState.data : null;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  // Load repository status + branches
  useEffect(() => {
    if (!directory) {
      setStatusState(null);
      setStatusError(null);
      return;
    }
    let cancelled = false;
    setLoadingStatus(true);
    setStatusError(null);

    serviceGet<GitStatusResponse>('/status', { directory })
      .then((next) => {
        if (cancelled) return;
        setStatusState({ directory, data: next });
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
  }, [directory, lifecycleTick, refreshTick, serviceGet]);

  const currentBranch = status?.current ?? null;
  const baseOverrideKey = directory && currentBranch ? `${directory}::${currentBranch}` : null;
  const chosenBase = baseOverrideKey ? baseOverrides[baseOverrideKey] ?? null : null;

  const branchBaseResolution = useMemo(() => {
    if (!status || !currentBranch || currentBranch === 'HEAD') return null;
    const all = status.branches.all ?? [];
    const primaryRemote = status.branches.primaryRemote;
    return resolveBranchComparisonBase(
      {
        chosen: chosenBase,
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
  }, [chosenBase, currentBranch, status]);

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

  const branchRangeKey =
    directory && qualifiedBranchBase && currentBranch && showBranchOption
      ? `${directory}::${qualifiedBranchBase}::${currentBranch}`
      : null;
  const branchFiles =
    branchRangeKey && branchFilesState?.key === branchRangeKey ? branchFilesState.files : null;

  // Fetch branch comparison files
  useEffect(() => {
    if (!directory || !qualifiedBranchBase || !currentBranch || !branchRangeKey) {
      setBranchFilesError(null);
      return;
    }
    let cancelled = false;
    setBranchFilesLoading(true);
    setBranchFilesError(null);

    serviceGet<{ files: GitRangeFile[] }>('/range-files', {
      directory,
      base: qualifiedBranchBase,
      head: currentBranch,
      includeWorkingTree: 'true',
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
    branchRangeKey,
    currentBranch,
    directory,
    lifecycleTick,
    qualifiedBranchBase,
    refreshTick,
    serviceGet,
  ]);

  // Fetch commit log when in commit scope
  const loadCommits = useCallback(() => {
    if (!directory) return;
    setCommitsLoading(true);
    setCommitsError(null);
    const to = currentBranch && currentBranch !== 'HEAD' ? `refs/heads/${currentBranch}` : 'HEAD';
    serviceGet<{ all: GitLogEntry[] }>('/log', { directory, maxCount: '50', to })
      .then((res) => {
        setCommits(res.all);
        setCommitsLoading(false);
        setSelectedCommitHash((prev) => {
          if (prev && res.all.some((c) => c.hash === prev)) return prev;
          return res.all[0]?.hash ?? null;
        });
      })
      .catch((err) => {
        setCommitsError(err instanceof Error ? err.message : String(err));
        setCommitsLoading(false);
      });
  }, [currentBranch, directory, serviceGet]);

  useEffect(() => {
    if (activeScope === 'commit' && directory) {
      loadCommits();
    }
  }, [activeScope, directory, lifecycleTick, loadCommits, refreshTick]);

  const commitScopeKey =
    directory && selectedCommitHash ? `${directory}::${selectedCommitHash}` : null;
  const commitFiles =
    commitScopeKey && commitFilesState?.key === commitScopeKey ? commitFilesState.files : null;

  // Fetch files for selected commit
  useEffect(() => {
    if (activeScope !== 'commit' || !directory || !selectedCommitHash || !commitScopeKey) {
      setCommitFilesError(null);
      return;
    }
    let cancelled = false;
    setCommitFilesLoading(true);
    setCommitFilesError(null);

    serviceGet<{ files: GitCommitFile[] }>('/commit-files', {
      directory,
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
  }, [activeScope, commitScopeKey, directory, selectedCommitHash, serviceGet]);

  const workingFileCount = useMemo(
    () => (status?.files ? status.files.filter(isWorkingStatusFile).length : 0),
    [status],
  );

  const stagedFileCount = useMemo(
    () => (status?.files ? status.files.filter(isStagedStatusFile).length : 0),
    [status],
  );

  const changedFiles = useMemo<FileEntry[]>(() => {
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
  }, [activeScope, branchFiles, commitFiles, status]);

  const filesSettled =
    activeScope === 'commit'
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
    const scopeKey = `${directory ?? ''}:${activeScope}:${
      activeScope === 'branch' ? qualifiedBranchBase ?? '' : ''
    }:${activeScope === 'commit' ? selectedCommitHash ?? '' : ''}`;
    const shouldInit = stackedScopeRef.current !== scopeKey;
    stackedScopeRef.current = scopeKey;

    setExpandedFiles((prev) => {
      if (shouldInit) {
        const count = getStackedViewDefaultExpandedCount(paths.length);
        return new Set(paths.slice(0, count));
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
  }, [activeScope, changedPathsKey, directory, filesSettled, qualifiedBranchBase, selectedCommitHash]);

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
      if (!directory) throw new Error('No project directory');
      const query: Record<string, string> = {
        directory,
        scope: activeScope,
        path: file.path,
        ignoreComments: ignoreComments ? 'true' : 'false',
      };
      if (file.previousPath) query.previousPath = file.previousPath;
      if (activeScope === 'branch' && qualifiedBranchBase && currentBranch) {
        query.base = qualifiedBranchBase;
        query.head = currentBranch;
      }
      if (activeScope === 'commit' && selectedCommitHash) {
        query.hash = selectedCommitHash;
      }
      return serviceGet<ServiceFileDiffResponse>('/file-diff', query);
    },
    [
      activeScope,
      currentBranch,
      directory,
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

  const requestKeyPrefix = `${directory ?? ''}::${activeScope}::${qualifiedBranchBase ?? ''}::${
    selectedCommitHash ?? ''
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

  const renderBody = () => {
    if (!directory) {
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
          {activeScope === 'commit'
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
          file={file}
          scope={activeScope}
          layout={getLayoutForFile(file)}
          wrapLines={wrapLines}
          themeId={themeId}
          isDark={isDark}
          isExpanded={isExpanded}
          isMounted={isMounted}
          onExpandedChange={handleExpandedChange}
          onLayoutChange={(path, nextLayout) =>
            setPerFileLayout((prev) => ({ ...prev, [path]: nextLayout }))
          }
          registerSectionRef={registerSectionRef}
          registerViewerRef={registerViewerRef}
          fetchFileDiff={fetchFileDiff}
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
        <ChangeScopeSelector
          scope={activeScope}
          workingCount={workingFileCount}
          stagedCount={stagedFileCount}
          branchCount={branchFiles?.length ?? null}
          commitCount={activeScope === 'commit' ? commitFiles?.length ?? null : null}
          showBranchOption={showBranchOption}
          onScopeChange={(nextScope) => {
            setUserPickedScope(true);
            setActiveScope(nextScope);
          }}
        />
        {activeScope === 'branch' ? (
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
