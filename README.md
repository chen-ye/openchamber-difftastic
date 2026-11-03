# openchamber-difftastic

Difftastic structural diff panel and full-screen page extension for OpenChamber.

## How it works

The extension pairs a local Node service with a React panel that reuses the viewmodel and rendering architecture of OpenChamber's built-in Changes panel:

- `service/main.ts` runs read-only `git` and `gh` commands for repository status, staged and working-tree stats, descendant Git repository and submodule discovery, branch merge-base comparisons, commit history, and GitHub pull requests, and invokes Difftastic through Git's external diff mode (`git -c diff.external=<difft> diff --ext-diff` and `git show --ext-diff`) with `DFT_UNSTABLE=yes` and `DFT_DISPLAY=json`.
- `src/difftToFileDiff.ts` adapts Difftastic's structured JSON output, including `aligned_lines`, `chunks`, and UTF-8 byte token spans, into `@pierre/diffs` `FileDiffMetadata` hunks and UTF-16 token decoration maps.
- `src/PierreDiffViewer.tsx` renders each file through `@pierre/diffs` `VirtualizedFileDiff` and `FileDiff` with `@pierre/highlights` syntax highlighting and paints Difftastic's structural token spans onto the rendered rows.
- `src/DiffView.tsx` provides:
  - Descendant repository and submodule discovery and switching via `NestedRepoPicker`, plus inline submodule summaries and nested repository file lists.
  - Scope switching across `Changed`, `Staged`, `Branch`, `Commit`, and `Pull requests`.
  - Branch comparison base picker with automatic base resolution and a target picker to compare against the working tree, committed `HEAD`, or another branch.
  - Compact file tree, stacked file view, side-by-side and inline toggles, line wrapping, comment-ignoring toggle, and find-in-diff.

## Requirements

- `git` on `PATH`
- `difft` on `PATH` or installed in `/home/linuxbrew/.linuxbrew/bin/difft`, `/opt/homebrew/bin/difft`, `/usr/local/bin/difft`, or `~/.cargo/bin/difft`
- `gh` on `PATH` for the `Pull requests` comparison scope

## Install in OpenChamber

1. Open **Settings -> Extensions -> Add**.
2. Enter `https://github.com/chen-ye/openchamber-difftastic.git`.
3. Approve the local service capability for `git`, `difft`, and `gh`.
4. Open **Difftastic** from the right-hand context rail or from the **Extension pages** menu.

## Development

```bash
bun install
bun run type-check
bun run build
bun test
```
