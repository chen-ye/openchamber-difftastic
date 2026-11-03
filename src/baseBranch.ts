export const branchRefLabel = (ref: string): string =>
  ref.replace(/^refs\/(heads|remotes)\//, '').replace(/^remotes\//, '');

export type BranchComparisonBaseSource = 'chosen' | 'pull-request' | 'created-from' | 'default';

export const qualifyBaseRef = (
  candidate: string | null | undefined,
  options: {
    localBranches: readonly string[];
    remoteBranches: readonly string[];
    remoteNames: ReadonlySet<string>;
    primaryRemote: string | null | undefined;
    allowAnyRemote?: boolean;
  },
): string | null => {
  const {
    localBranches,
    remoteBranches,
    remoteNames,
    primaryRemote,
    allowAnyRemote = false,
  } = options;
  const trimmed = candidate?.trim() ?? '';
  if (trimmed.startsWith('refs/heads/')) {
    const local = trimmed.slice('refs/heads/'.length);
    return localBranches.includes(local) ? trimmed : null;
  }
  const explicitRemote =
    trimmed.startsWith('refs/remotes/') || trimmed.startsWith('remotes/');
  let branch = trimmed.replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
  if (!branch) return null;
  const slashIndex = branch.indexOf('/');
  if (
    slashIndex > 0 &&
    remoteNames.has(branch.slice(0, slashIndex)) &&
    !localBranches.includes(branch)
  ) {
    const remoteName = branch.slice(0, slashIndex);
    if ((allowAnyRemote || explicitRemote) && remoteBranches.includes(branch)) {
      return branch;
    }
    if (remoteName !== primaryRemote) return null;
    branch = branch.slice(slashIndex + 1);
  }
  if (primaryRemote && remoteBranches.includes(`${primaryRemote}/${branch}`)) {
    return `${primaryRemote}/${branch}`;
  }
  if (localBranches.includes(branch)) return `refs/heads/${branch}`;
  return null;
};

const stripRemotePrefix = (ref: string, remoteNames: ReadonlySet<string>): string => {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  const clean = ref.replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
  const slash = clean.indexOf('/');
  if (slash > 0 && remoteNames.has(clean.slice(0, slash))) {
    return clean.slice(slash + 1);
  }
  return clean;
};

export const resolveBranchComparisonBase = (
  candidates: {
    chosen: string | null;
    pullRequest?: string | null;
    createdFrom: string | null;
    defaultBranch: string | null;
  },
  options: Parameters<typeof qualifyBaseRef>[1] & { headBranch: string },
): { ref: string; source: BranchComparisonBaseSource } | null => {
  const order: Array<[BranchComparisonBaseSource, string | null | undefined]> = [
    ['chosen', candidates.chosen],
    ['pull-request', candidates.pullRequest],
    ['created-from', candidates.createdFrom],
    ['default', candidates.defaultBranch],
  ];
  for (const [source, candidate] of order) {
    const ref = qualifyBaseRef(candidate, {
      ...options,
      allowAnyRemote: source === 'chosen',
    });
    if (!ref) continue;
    if (source === 'chosen') {
      if (ref !== `refs/heads/${options.headBranch}`) {
        return { ref, source };
      }
      continue;
    }
    const branch = stripRemotePrefix(ref, options.remoteNames);
    if (branch !== options.headBranch) return { ref, source };
  }
  return null;
};

export const isBranchScopeAvailable = (
  currentBranch: string | null,
  base: string | null,
): boolean => Boolean(currentBranch && currentBranch !== 'HEAD') && base !== null;
