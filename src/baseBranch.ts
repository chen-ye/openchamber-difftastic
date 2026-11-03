export const branchRefLabel = (ref: string): string =>
  ref.replace(/^refs\/(heads|remotes)\//, '').replace(/^remotes\//, '');

export type BranchComparisonBaseSource = 'chosen' | 'created-from' | 'default';

export const qualifyBaseRef = (
  candidate: string | null | undefined,
  options: {
    localBranches: readonly string[];
    remoteBranches: readonly string[];
    remoteNames: ReadonlySet<string>;
    primaryRemote: string | null | undefined;
  },
): string | null => {
  const { localBranches, remoteBranches, remoteNames, primaryRemote } = options;
  const trimmed = candidate?.trim() ?? '';
  if (trimmed.startsWith('refs/heads/')) {
    const local = trimmed.slice('refs/heads/'.length);
    return localBranches.includes(local) ? trimmed : null;
  }
  let branch = trimmed.replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
  if (!branch) return null;
  const slashIndex = branch.indexOf('/');
  if (
    slashIndex > 0 &&
    remoteNames.has(branch.slice(0, slashIndex)) &&
    !localBranches.includes(branch)
  ) {
    if (branch.slice(0, slashIndex) !== primaryRemote) return null;
    branch = branch.slice(slashIndex + 1);
  }
  if (primaryRemote && remoteBranches.includes(`${primaryRemote}/${branch}`)) {
    return `${primaryRemote}/${branch}`;
  }
  if (localBranches.includes(branch)) return `refs/heads/${branch}`;
  return null;
};

export const resolveBranchComparisonBase = (
  candidates: {
    chosen: string | null;
    createdFrom: string | null;
    defaultBranch: string | null;
  },
  options: Parameters<typeof qualifyBaseRef>[1] & { headBranch: string },
): { ref: string; source: BranchComparisonBaseSource } | null => {
  const order: Array<[BranchComparisonBaseSource, string | null]> = [
    ['chosen', candidates.chosen],
    ['created-from', candidates.createdFrom],
    ['default', candidates.defaultBranch],
  ];
  for (const [source, candidate] of order) {
    const ref = qualifyBaseRef(candidate, options);
    if (!ref) continue;
    const branch = ref.startsWith('refs/heads/')
      ? ref.slice('refs/heads/'.length)
      : options.primaryRemote && ref.startsWith(`${options.primaryRemote}/`)
        ? ref.slice(options.primaryRemote.length + 1)
        : ref;
    if (branch !== options.headBranch) return { ref, source };
  }
  return null;
};

export const isBranchScopeAvailable = (
  currentBranch: string | null,
  base: string | null,
): boolean => Boolean(currentBranch && currentBranch !== 'HEAD') && base !== null;
