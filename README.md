# openchamber-difftastic

Difftastic structural diff panel and full-screen page extension for OpenChamber.

## How it works

The extension pairs a local Node service with a React panel that reuses the viewmodel and rendering architecture of OpenChamber's built-in Changes panel:

- `service/main.ts` runs read-only `git` commands for repository status, staged and working-tree stats, branch merge-base comparisons, and commit history, then invokes `difft --display=json` with `DFT_UNSTABLE=yes` on the old and new file contents.
- `src/difftToFileDiff.ts` adapts Difftastic's structured JSON output, including `aligned_lines`, `chunks`, and UTF-8 byte token spans, into `@pierre/diffs` `FileDiffMetadata` hunks and UTF-16 token decoration maps.
- `src/PierreDiffViewer.tsx` renders each file through `@pierre/diffs` `VirtualizedFileDiff` and `FileDiff` with `@pierre/highlights` syntax highlighting and paints Difftastic's structural token spans onto the rendered rows.
- `src/DiffView.tsx` provides the same scope switcher for `Changed`, `Staged`, `Branch`, and `Commit`, branch base selector, commit selector, compact file tree, stacked file view, side-by-side and inline toggles, line wrapping, comment-ignoring toggle, and find-in-diff bar as the built-in Changes view.

## Requirements

- `git` on `PATH`
- `difft` on `PATH` or installed in `/home/linuxbrew/.linuxbrew/bin/difft`, `/opt/homebrew/bin/difft`, `/usr/local/bin/difft`, or `~/.cargo/bin/difft`

## Install in OpenChamber

1. Open **Settings -> Extensions -> Add**.
2. Enter `https://github.com/chen-ye/openchamber-difftastic.git`.
3. Approve the local service capability for `git` and `difft`.
4. Open **Difftastic** from the right-hand context rail or from the **Extension pages** menu.

## Development

```bash
bun install
bun run type-check
bun run build
bun test
```
