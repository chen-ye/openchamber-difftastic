import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Icon, type IconName } from './icons';
import { branchRefLabel } from './baseBranch';
import type {
  DiffScope,
  DiffViewMode,
  GitLogEntry,
  GitPullRequestEntry,
} from './types';

const useClickOutsideAndEscape = (
  open: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [containerRef, onClose, open]);
};

const isNavDown = (event: React.KeyboardEvent): boolean =>
  event.key === 'ArrowDown' ||
  (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'n');

const isNavUp = (event: React.KeyboardEvent): boolean =>
  event.key === 'ArrowUp' ||
  (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'p');

export interface ToolbarIconButtonProps {
  label: string;
  icon: IconName;
  pressed?: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  iconClassName?: string;
}

export const ToolbarIconButton: React.FC<ToolbarIconButtonProps> = ({
  label,
  icon,
  pressed,
  disabled,
  onClick,
  className = '',
  iconClassName = 'oc-icon',
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
    className={`oc-toolbar-icon-btn ${pressed ? 'oc-toolbar-icon-btn--pressed' : ''} ${className}`}
  >
    <Icon name={icon} className={iconClassName} />
  </button>
);

export const DiffViewToggle: React.FC<{
  mode: DiffViewMode;
  onModeChange: (mode: DiffViewMode) => void;
}> = ({ mode, onModeChange }) => (
  <ToolbarIconButton
    label="Side by side"
    icon="layout-column"
    pressed={mode === 'side-by-side'}
    onClick={(event) => {
      event.stopPropagation();
      onModeChange(mode === 'side-by-side' ? 'unified' : 'side-by-side');
    }}
  />
);

export interface NestedRepoPickerProps {
  repositories: readonly string[];
  selectedRepository: string | null;
  onSelectRepository: (repository: string) => void;
  repositoryRoot?: string | null;
}

export const NestedRepoPicker: React.FC<NestedRepoPickerProps> = ({
  repositories,
  selectedRepository,
  onSelectRepository,
  repositoryRoot,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useClickOutsideAndEscape(
    open,
    () => {
      setOpen(false);
      setSearch('');
    },
    containerRef,
  );

  useEffect(() => {
    if (open && repositories.length > 5) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, repositories.length]);

  const relativePath = (repo: string): string => {
    if (repo === repositoryRoot) {
      return repo.split('/').filter(Boolean).pop() ?? repo;
    }
    const rootPrefix = `${(repositoryRoot ?? '').replace(/\/+$/, '')}/`;
    return repo.startsWith(rootPrefix) ? repo.slice(rootPrefix.length) : repo;
  };

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return repositories
      .map((repo) => ({ path: repo, label: relativePath(repo) }))
      .filter((item) => !q || item.label.toLowerCase().includes(q));
  }, [repositories, repositoryRoot, search]);

  const currentLabel = selectedRepository ? relativePath(selectedRepository) : 'Select repository';

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (isNavDown(event) || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setActiveIndex(
          Math.max(
            0,
            options.findIndex((o) => o.path === selectedRepository),
          ),
        );
        setOpen(true);
      }
      return;
    }
    if (isNavDown(event)) {
      event.preventDefault();
      if (options.length > 0) setActiveIndex((prev) => (prev + 1) % options.length);
    } else if (isNavUp(event)) {
      event.preventDefault();
      if (options.length > 0) {
        setActiveIndex((prev) => (prev - 1 + options.length) % options.length);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = options[activeIndex];
      if (target) {
        onSelectRepository(target.path);
        setOpen(false);
        setSearch('');
      }
    }
  };

  return (
    <div ref={containerRef} className="oc-dropdown" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="oc-picker-trigger oc-picker-trigger--repo"
        title={selectedRepository ?? currentLabel}
        aria-label="Select repository"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(
            Math.max(
              0,
              options.findIndex((o) => o.path === selectedRepository),
            ),
          );
          setOpen((prev) => !prev);
        }}
      >
        <Icon name="folder-3" className="oc-icon-sm oc-muted-icon" />
        <span className="oc-picker-trigger-label">{currentLabel}</span>
        <Icon name="arrow-down-s" className="oc-icon-sm oc-muted-icon" />
      </button>
      {open ? (
        <div className="oc-dropdown-menu oc-dropdown-menu--branch">
          {repositories.length > 5 ? (
            <div className="oc-dropdown-search-wrap">
              <Icon name="search" className="oc-icon-sm oc-dropdown-search-icon" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Filter repositories…"
                className="oc-dropdown-search-input"
              />
            </div>
          ) : null}
          <div role="listbox" className="oc-dropdown-list">
            {options.length === 0 ? (
              <div className="oc-dropdown-empty">No matching repositories</div>
            ) : (
              options.map((option, index) => {
                const selected = option.path === selectedRepository;
                const highlighted = index === activeIndex;
                return (
                  <button
                    key={option.path}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`oc-dropdown-item ${highlighted ? 'oc-dropdown-item--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      onSelectRepository(option.path);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="oc-dropdown-item-label" title={option.path}>
                      {option.label}
                    </span>
                    {selected ? <Icon name="check" className="oc-icon-sm" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export interface ChangeScopeSelectorProps {
  scope: DiffScope;
  workingCount: number;
  stagedCount: number;
  branchCount: number | null;
  commitCount: number | null;
  prCount: number | null;
  showBranchOption: boolean;
  onScopeChange: (scope: DiffScope) => void;
}

export const ChangeScopeSelector: React.FC<ChangeScopeSelectorProps> = ({
  scope,
  workingCount,
  stagedCount,
  branchCount,
  commitCount,
  prCount,
  showBranchOption,
  onScopeChange,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useClickOutsideAndEscape(open, () => setOpen(false), containerRef);

  const items = useMemo(() => {
    const list: Array<{ value: DiffScope; label: string; count: number | null }> = [
      { value: 'working', label: 'Changed', count: workingCount },
      { value: 'staged', label: 'Staged', count: stagedCount },
    ];
    if (showBranchOption) {
      list.push({ value: 'branch', label: 'Branch', count: branchCount });
    }
    list.push({ value: 'commit', label: 'Commit', count: commitCount });
    list.push({ value: 'pr', label: 'Pull requests', count: prCount });
    return list;
  }, [branchCount, commitCount, prCount, showBranchOption, stagedCount, workingCount]);

  const current = items.find((item) => item.value === scope) ?? items[0];

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (isNavDown(event) || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setActiveIndex(Math.max(0, items.findIndex((i) => i.value === scope)));
        setOpen(true);
      }
      return;
    }
    if (isNavDown(event)) {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % items.length);
    } else if (isNavUp(event)) {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = items[activeIndex];
      if (target) {
        onScopeChange(target.value);
        setOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className="oc-dropdown" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="oc-scope-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select diff scope"
        onClick={() => {
          setActiveIndex(Math.max(0, items.findIndex((i) => i.value === scope)));
          setOpen((prev) => !prev);
        }}
      >
        <span className="oc-scope-trigger-label">
          {current?.label ?? 'Changed'}
          {current && current.count !== null ? (
            <span className="oc-scope-trigger-count">: {current.count}</span>
          ) : null}
        </span>
        <Icon name="arrow-down-s" className="oc-icon oc-muted-icon" />
      </button>
      {open ? (
        <div role="listbox" className="oc-dropdown-menu oc-dropdown-menu--scope">
          {items.map((item, index) => {
            const selected = item.value === scope;
            const highlighted = index === activeIndex;
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`oc-dropdown-item ${highlighted ? 'oc-dropdown-item--active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onScopeChange(item.value);
                  setOpen(false);
                }}
              >
                <span className="oc-dropdown-item-check">
                  {selected ? <Icon name="check" className="oc-icon-sm" /> : null}
                </span>
                <span className="oc-dropdown-item-label">{item.label}</span>
                <span className="oc-dropdown-item-meta">{item.count ?? '…'}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export interface BranchComparisonSelectorProps {
  branches: readonly string[];
  currentBranch: string | null;
  base: string | null;
  automatic: boolean;
  onSelect: (ref: string) => void;
  onSelectAutomatic: () => void;
}

export const BranchComparisonSelector: React.FC<BranchComparisonSelectorProps> = ({
  branches,
  currentBranch,
  base,
  automatic,
  onSelect,
  onSelectAutomatic,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useClickOutsideAndEscape(
    open,
    () => {
      setOpen(false);
      setSearch('');
    },
    containerRef,
  );

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list: Array<{ ref: string; label: string; isAutomatic?: boolean }> = [];
    if (!query) {
      list.push({ ref: '__automatic__', label: 'Automatic', isAutomatic: true });
    }
    const unique = [...new Set(branches)]
      .filter((name) => name !== currentBranch)
      .sort()
      .map((name) => ({
        ref: name.startsWith('remotes/') ? `refs/${name}` : `refs/heads/${name}`,
        label: branchRefLabel(name),
      }))
      .filter((item) => !query || item.label.toLowerCase().includes(query));
    list.push(...unique);
    return list;
  }, [branches, currentBranch, search]);

  const label = base ? branchRefLabel(base) : 'Base branch';

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isNavDown(event)) {
      event.preventDefault();
      if (options.length > 0) setActiveIndex((prev) => (prev + 1) % options.length);
    } else if (isNavUp(event)) {
      event.preventDefault();
      if (options.length > 0) {
        setActiveIndex((prev) => (prev - 1 + options.length) % options.length);
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const chosen = options[activeIndex];
      if (!chosen) return;
      if (chosen.isAutomatic) onSelectAutomatic();
      else onSelect(chosen.ref);
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div ref={containerRef} className="oc-dropdown" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="oc-picker-trigger"
        disabled={!currentBranch}
        title={`Base: ${label}`}
        aria-label="Base branch"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(0);
          setOpen((prev) => !prev);
        }}
      >
        <Icon name="git-branch" className="oc-icon-sm oc-muted-icon" />
        <span className="oc-picker-trigger-label">{label}</span>
        <Icon name="arrow-down-s" className="oc-icon-sm oc-muted-icon" />
      </button>
      {open ? (
        <div className="oc-dropdown-menu oc-dropdown-menu--branch">
          <div className="oc-dropdown-search-wrap">
            <Icon name="search" className="oc-icon-sm oc-dropdown-search-icon" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveIndex(0);
              }}
              placeholder="Search base branch…"
              className="oc-dropdown-search-input"
            />
          </div>
          <div role="listbox" className="oc-dropdown-list">
            {options.length === 0 ? (
              <div className="oc-dropdown-empty">No matching branches</div>
            ) : (
              options.map((option, index) => {
                const selected = option.isAutomatic
                  ? automatic
                  : !automatic && (option.ref === base || option.label === base);
                const highlighted = index === activeIndex;
                return (
                  <button
                    key={option.ref}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`oc-dropdown-item ${highlighted ? 'oc-dropdown-item--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      if (option.isAutomatic) onSelectAutomatic();
                      else onSelect(option.ref);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="oc-dropdown-item-label" title={option.label}>
                      {option.label}
                    </span>
                    {selected ? <Icon name="check" className="oc-icon-sm" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export type BranchTargetValue =
  | { kind: 'working-tree' }
  | { kind: 'head-committed' }
  | { kind: 'ref'; ref: string };

export interface BranchTargetSelectorProps {
  branches: readonly string[];
  currentBranch: string | null;
  base?: string | null;
  target: BranchTargetValue;
  onSelect: (target: BranchTargetValue) => void;
}

export const BranchTargetSelector: React.FC<BranchTargetSelectorProps> = ({
  branches,
  currentBranch,
  base,
  target,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useClickOutsideAndEscape(
    open,
    () => {
      setOpen(false);
      setSearch('');
    },
    containerRef,
  );

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list: Array<{ key: string; label: string; value: BranchTargetValue }> = [];
    const wtLabel = currentBranch
      ? `${currentBranch} + working tree`
      : 'Working tree';
    const headLabel = currentBranch ? `${currentBranch} (committed)` : 'HEAD (committed)';

    if (!query || wtLabel.toLowerCase().includes(query)) {
      list.push({ key: '__wt__', label: wtLabel, value: { kind: 'working-tree' } });
    }
    if (!query || headLabel.toLowerCase().includes(query)) {
      list.push({ key: '__head__', label: headLabel, value: { kind: 'head-committed' } });
    }

    const baseLabel = base ? branchRefLabel(base) : null;
    const otherBranches = [...new Set(branches)]
      .filter((name) => name !== currentBranch)
      .sort()
      .map((name) => {
        const ref = name.startsWith('remotes/') ? `refs/${name}` : `refs/heads/${name}`;
        return {
          key: ref,
          label: branchRefLabel(name),
          value: { kind: 'ref' as const, ref },
        };
      })
      .filter(
        (item) =>
          item.key !== base &&
          item.label !== baseLabel &&
          (!query || item.label.toLowerCase().includes(query)),
      );

    list.push(...otherBranches);
    return list;
  }, [base, branches, currentBranch, search]);

  const currentLabel =
    target.kind === 'working-tree'
      ? 'Working tree'
      : target.kind === 'head-committed'
        ? 'Committed'
        : branchRefLabel(target.ref);

  const isSelected = (val: BranchTargetValue): boolean => {
    if (val.kind !== target.kind) return false;
    if (val.kind === 'ref' && target.kind === 'ref') return val.ref === target.ref;
    return true;
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isNavDown(event)) {
      event.preventDefault();
      if (options.length > 0) setActiveIndex((prev) => (prev + 1) % options.length);
    } else if (isNavUp(event)) {
      event.preventDefault();
      if (options.length > 0) {
        setActiveIndex((prev) => (prev - 1 + options.length) % options.length);
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const chosen = options[activeIndex];
      if (!chosen) return;
      onSelect(chosen.value);
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div ref={containerRef} className="oc-dropdown" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="oc-picker-trigger"
        title={`Compare target: ${currentLabel}`}
        aria-label="Compare target"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(0);
          setOpen((prev) => !prev);
        }}
      >
        <span className="oc-picker-trigger-prefix">→</span>
        <span className="oc-picker-trigger-label">{currentLabel}</span>
        <Icon name="arrow-down-s" className="oc-icon-sm oc-muted-icon" />
      </button>
      {open ? (
        <div className="oc-dropdown-menu oc-dropdown-menu--branch">
          <div className="oc-dropdown-search-wrap">
            <Icon name="search" className="oc-icon-sm oc-dropdown-search-icon" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveIndex(0);
              }}
              placeholder="Compare against target…"
              className="oc-dropdown-search-input"
            />
          </div>
          <div role="listbox" className="oc-dropdown-list">
            {options.length === 0 ? (
              <div className="oc-dropdown-empty">No matching targets</div>
            ) : (
              options.map((option, index) => {
                const selected = isSelected(option.value);
                const highlighted = index === activeIndex;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`oc-dropdown-item ${highlighted ? 'oc-dropdown-item--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      onSelect(option.value);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="oc-dropdown-item-label" title={option.label}>
                      {option.label}
                    </span>
                    {selected ? <Icon name="check" className="oc-icon-sm" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export interface CommitComparisonSelectorProps {
  commits: readonly GitLogEntry[];
  selectedHash: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (commit: GitLogEntry) => void;
  onRefresh: () => void;
}

export const CommitComparisonSelector: React.FC<CommitComparisonSelectorProps> = ({
  commits,
  selectedHash,
  loading,
  error,
  onSelect,
  onRefresh,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useClickOutsideAndEscape(
    open,
    () => {
      setOpen(false);
      setSearch('');
    },
    containerRef,
  );

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commits;
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(q) ||
        c.author_name.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q),
    );
  }, [commits, search]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isNavDown(event)) {
      event.preventDefault();
      if (filtered.length > 0) setActiveIndex((prev) => (prev + 1) % filtered.length);
    } else if (isNavUp(event)) {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target) {
        onSelect(target);
        setOpen(false);
        setSearch('');
      }
    }
  };

  return (
    <div ref={containerRef} className="oc-dropdown" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="oc-picker-trigger"
        title={selectedHash ?? 'Select commit'}
        aria-label="Select commit"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(0);
          const next = !open;
          setOpen(next);
          if (next && !loading) onRefresh();
        }}
      >
        <Icon name="git-commit" className="oc-icon-sm oc-muted-icon" />
        <span className="oc-picker-trigger-label">
          {selectedHash ? selectedHash.slice(0, 8) : 'Select commit'}
        </span>
        <Icon name="arrow-down-s" className="oc-icon-sm oc-muted-icon" />
      </button>
      {open ? (
        <div className="oc-dropdown-menu oc-dropdown-menu--commit">
          <div className="oc-dropdown-search-wrap">
            <Icon name="search" className="oc-icon-sm oc-dropdown-search-icon" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveIndex(0);
              }}
              placeholder="Search commits by message, author, or hash…"
              className="oc-dropdown-search-input"
            />
          </div>
          {loading ? (
            <div className="oc-dropdown-empty">
              <Icon name="loader-4" className="oc-icon oc-spin" /> Loading commits…
            </div>
          ) : error ? (
            <div className="oc-dropdown-empty">
              <span>{error}</span>
              <button type="button" className="oc-link-btn" onClick={onRefresh}>
                Retry
              </button>
            </div>
          ) : (
            <div role="listbox" className="oc-dropdown-list">
              {filtered.length === 0 ? (
                <div className="oc-dropdown-empty">No matching commits</div>
              ) : (
                filtered.map((commit, index) => {
                  const selected = commit.hash === selectedHash;
                  const highlighted = index === activeIndex;
                  const shortDate = Number.isNaN(new Date(commit.date).getTime())
                    ? commit.date
                    : new Date(commit.date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      });
                  return (
                    <button
                      key={commit.hash}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`oc-dropdown-item oc-dropdown-item--commit ${
                        highlighted ? 'oc-dropdown-item--active' : ''
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        onSelect(commit);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <div className="oc-commit-option-body">
                        <div className="oc-commit-option-title" title={commit.message}>
                          {commit.message}
                        </div>
                        <div className="oc-commit-option-meta">
                          <span>
                            {commit.author_name} · {shortDate} · {commit.hash.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                      {selected ? <Icon name="check" className="oc-icon-sm" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export interface PullRequestComparisonSelectorProps {
  prs: readonly GitPullRequestEntry[];
  selectedNumber: number | null;
  loading: boolean;
  error: string | null;
  onSelect: (pr: GitPullRequestEntry) => void;
  onRefresh: () => void;
}

export const PullRequestComparisonSelector: React.FC<PullRequestComparisonSelectorProps> = ({
  prs,
  selectedNumber,
  loading,
  error,
  onSelect,
  onRefresh,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useClickOutsideAndEscape(
    open,
    () => {
      setOpen(false);
      setSearch('');
    },
    containerRef,
  );

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prs;
    return prs.filter(
      (pr) =>
        `#${pr.number}`.includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        pr.author.toLowerCase().includes(q) ||
        pr.headRefName.toLowerCase().includes(q) ||
        pr.baseRefName.toLowerCase().includes(q),
    );
  }, [prs, search]);

  const selectedPr = prs.find((pr) => pr.number === selectedNumber) ?? null;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isNavDown(event)) {
      event.preventDefault();
      if (filtered.length > 0) setActiveIndex((prev) => (prev + 1) % filtered.length);
    } else if (isNavUp(event)) {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target) {
        onSelect(target);
        setOpen(false);
        setSearch('');
      }
    }
  };

  return (
    <div ref={containerRef} className="oc-dropdown" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="oc-picker-trigger"
        title={selectedPr ? `#${selectedPr.number} ${selectedPr.title}` : 'Select pull request'}
        aria-label="Select pull request"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(0);
          const next = !open;
          setOpen(next);
          if (next && !loading) onRefresh();
        }}
      >
        <Icon name="git-pull-request" className="oc-icon-sm oc-muted-icon" />
        <span className="oc-picker-trigger-label">
          {selectedNumber ? `#${selectedNumber}` : 'Select PR'}
        </span>
        <Icon name="arrow-down-s" className="oc-icon-sm oc-muted-icon" />
      </button>
      {open ? (
        <div className="oc-dropdown-menu oc-dropdown-menu--commit">
          <div className="oc-dropdown-search-wrap">
            <Icon name="search" className="oc-icon-sm oc-dropdown-search-icon" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveIndex(0);
              }}
              placeholder="Search pull requests by #number, title, or branch…"
              className="oc-dropdown-search-input"
            />
          </div>
          {loading ? (
            <div className="oc-dropdown-empty">
              <Icon name="loader-4" className="oc-icon oc-spin" /> Loading pull requests…
            </div>
          ) : error && prs.length === 0 ? (
            <div className="oc-dropdown-empty">
              <span>{error}</span>
              <button type="button" className="oc-link-btn" onClick={onRefresh}>
                Retry
              </button>
            </div>
          ) : (
            <div role="listbox" className="oc-dropdown-list">
              {filtered.length === 0 ? (
                <div className="oc-dropdown-empty">No pull requests found</div>
              ) : (
                filtered.map((pr, index) => {
                  const selected = pr.number === selectedNumber;
                  const highlighted = index === activeIndex;
                  return (
                    <button
                      key={pr.number}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`oc-dropdown-item oc-dropdown-item--commit ${
                        highlighted ? 'oc-dropdown-item--active' : ''
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        onSelect(pr);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <div className="oc-commit-option-body">
                        <div
                          className="oc-commit-option-title"
                          title={`#${pr.number} ${pr.title}`}
                        >
                          #{pr.number} {pr.title}
                        </div>
                        <div className="oc-commit-option-meta">
                          <span>
                            {pr.author} · {pr.headRefName} → {pr.baseRefName} · {pr.state}
                          </span>
                        </div>
                      </div>
                      {selected ? <Icon name="check" className="oc-icon-sm" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
