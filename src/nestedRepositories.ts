const SEPARATOR = /[\\/]+/;

const segmentsUnderRoot = (root: string, repository: string): string[] => {
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  const relative = repository.startsWith(normalizedRoot)
    ? repository.slice(normalizedRoot.length)
    : repository;
  return relative.split(SEPARATOR).filter((segment) => segment.length > 0);
};

const isHiddenRepository = (root: string, repository: string): boolean =>
  segmentsUnderRoot(root, repository).some((segment) => segment.startsWith('.'));

/**
 * Picks the first non-hidden nested repository when the workspace root itself
 * is not a Git repository. Hidden `.` directories remain available in the
 * manual picker.
 */
export const chooseAutoNestedRepo = (
  root: string,
  repositories: readonly string[] | null | undefined,
): string | null => {
  if (!Array.isArray(repositories) || repositories.length === 0) return null;
  const visible = repositories.find((repository) => !isHiddenRepository(root, repository));
  return visible ?? null;
};

const withoutTrailingSeparator = (value: string): string => value.replace(/[\\/]+$/, '');

export const discoversNestedRepos = (
  root: string,
  homeDirectory: string | null | undefined,
): boolean => {
  if (!homeDirectory) return true;
  return withoutTrailingSeparator(root) !== withoutTrailingSeparator(homeDirectory);
};
