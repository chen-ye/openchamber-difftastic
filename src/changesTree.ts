export const TREE_INDENT_PX = 14;

type TreeFile = { path: string };

export type ChangesTreeDirectoryNode<F extends TreeFile> = {
  id: string;
  path: string;
  name: string;
  children: Map<string, ChangesTreeDirectoryNode<F>>;
  directFiles: F[];
  files: F[];
};

export type DiffTreeRow<F extends { path: string }> =
  | {
      kind: 'directory';
      key: string;
      depth: number;
      path: string;
      label: string;
      fileCount: number;
      expanded: boolean;
    }
  | {
      kind: 'file';
      key: string;
      depth: number;
      name: string;
      file: F;
    };

export const changedPathName = (path: string): string =>
  path.slice(path.lastIndexOf('/', path.length - 2) + 1);

const normalizePathForTree = (value: string): string =>
  value.replace(/\\/g, '/').replace(/^\/+/, '').trim();

const createDirectoryNode = <F extends TreeFile>(
  path: string,
  name: string,
): ChangesTreeDirectoryNode<F> => ({
  id: `dir:${path}`,
  path,
  name,
  children: new Map(),
  directFiles: [],
  files: [],
});

export const buildChangesTree = <F extends TreeFile>(
  entries: F[],
): ChangesTreeDirectoryNode<F> => {
  const root = createDirectoryNode<F>('', '');

  for (const file of entries) {
    const normalized = normalizePathForTree(file.path);
    if (!normalized) continue;

    const segments = normalized.split('/').filter(Boolean);
    const directorySegments = segments.slice(0, -1);
    let current = root;
    current.files.push(file);

    if (directorySegments.length > 0) {
      let currentPath = '';
      for (const segment of directorySegments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const existing = current.children.get(segment);
        if (existing) {
          existing.files.push(file);
          current = existing;
          continue;
        }

        const created = createDirectoryNode<F>(currentPath, segment);
        created.files.push(file);
        current.children.set(segment, created);
        current = created;
      }
    }

    current.directFiles.push(file);
  }

  return root;
};

export const compactDirectory = <F extends TreeFile>(
  directory: ChangesTreeDirectoryNode<F>,
): { node: ChangesTreeDirectoryNode<F>; label: string } => {
  let node = directory;
  let label = directory.name;
  while (node.directFiles.length === 0 && node.children.size === 1) {
    const [only] = node.children.values();
    if (!only) break;
    node = only;
    label = `${label}/${only.name}`;
  }
  return { node, label };
};

export const buildDiffTreeRows = <F extends { path: string }>(
  files: F[],
  collapsed: ReadonlySet<string>,
): DiffTreeRow<F>[] => {
  const rows: DiffTreeRow<F>[] = [];

  const walk = (node: ChangesTreeDirectoryNode<F>, depth: number) => {
    const directories = Array.from(node.children.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const directory of directories) {
      const { node: target, label } = compactDirectory(directory);
      const expanded = !collapsed.has(target.path);
      rows.push({
        kind: 'directory',
        key: `dir:${target.path}`,
        depth,
        path: target.path,
        label,
        fileCount: target.files.length,
        expanded,
      });
      if (expanded) {
        walk(target, depth + 1);
      }
    }

    const directFiles = [...node.directFiles].sort((a, b) =>
      changedPathName(a.path).localeCompare(changedPathName(b.path)),
    );
    for (const file of directFiles) {
      rows.push({
        kind: 'file',
        key: `file:${file.path}`,
        depth,
        name: changedPathName(file.path),
        file,
      });
    }
  };

  walk(buildChangesTree(files), 0);
  return rows;
};
