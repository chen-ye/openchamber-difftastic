export const PANEL_CSS = `
  *, *::before, *::after {
    box-sizing: border-box;
  }

  html, body, #root {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--surface-background, var(--oc-bg, transparent));
    color: var(--surface-foreground, var(--oc-fg, inherit));
    font-family: var(--font-sans, var(--oc-font, system-ui, -apple-system, sans-serif));
    font-size: 13px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }

  button, input {
    font: inherit;
    color: inherit;
    margin: 0;
  }

  button {
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
  }

  button:disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .oc-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    display: inline-block;
    vertical-align: middle;
  }

  .oc-icon-sm {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: inline-block;
    vertical-align: middle;
  }

  .oc-muted-icon {
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-shrink-0 {
    flex-shrink: 0;
  }

  @keyframes oc-spin {
    to { transform: rotate(360deg); }
  }

  .oc-spin {
    animation: oc-spin 0.8s linear infinite;
  }

  .oc-diff-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--surface-background, var(--oc-bg));
  }

  /* Toolbar */
  .oc-diff-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 6px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 50%, transparent);
    background: var(--surface-background, var(--oc-bg));
    flex-shrink: 0;
  }

  .oc-toolbar-spacer {
    flex: 1 1 auto;
    min-width: 4px;
  }

  .oc-toolbar-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: calc(var(--radius, 9px) - 2px);
    color: var(--surface-muted-foreground, var(--oc-muted));
    transition: background-color 0.12s ease, color 0.12s ease;
    flex-shrink: 0;
  }

  .oc-toolbar-icon-btn:hover,
  .oc-toolbar-icon-btn:focus-visible {
    background: var(--interactive-hover, var(--oc-hover));
    color: var(--surface-foreground, var(--oc-fg));
    outline: none;
  }

  .oc-toolbar-icon-btn--pressed {
    background: var(--interactive-selection, var(--oc-selection));
    color: var(--interactive-selection-foreground, var(--oc-selection-fg));
  }

  .oc-toolbar-text-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    border-radius: calc(var(--radius, 9px) - 2px);
    color: var(--surface-muted-foreground, var(--oc-muted));
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .oc-toolbar-text-btn:hover,
  .oc-toolbar-text-btn:focus-visible {
    background: var(--interactive-hover, var(--oc-hover));
    color: var(--surface-foreground, var(--oc-fg));
    outline: none;
  }

  @media (max-width: 580px) {
    .oc-toolbar-text-btn-label {
      display: none;
    }
  }

  /* Dropdowns & Triggers */
  .oc-dropdown {
    position: relative;
    display: inline-flex;
    min-width: 0;
    flex-shrink: 0;
  }

  .oc-scope-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border-radius: calc(var(--radius, 9px) - 2px);
    font-size: 13px;
    font-weight: 600;
    color: var(--surface-foreground, var(--oc-fg));
    white-space: nowrap;
  }

  .oc-scope-trigger:hover,
  .oc-scope-trigger:focus-visible {
    background: var(--interactive-hover, var(--oc-hover));
    outline: none;
  }

  .oc-scope-trigger-count {
    font-weight: 500;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-picker-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    max-width: 190px;
    min-width: 0;
    padding: 0 9px;
    border-radius: calc(var(--radius, 9px) - 2px);
    border: 1px solid color-mix(in srgb, var(--surface-foreground, var(--oc-fg)) 14%, transparent);
    background: var(--surface-elevated, var(--oc-elevated));
    font-size: 12.5px;
    font-weight: 500;
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-picker-trigger:hover,
  .oc-picker-trigger:focus-visible {
    background: var(--interactive-hover, var(--oc-hover));
    outline: none;
  }

  .oc-picker-trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .oc-picker-trigger--repo {
    max-width: 180px;
  }

  .oc-picker-trigger-prefix {
    color: var(--surface-muted-foreground, var(--oc-muted));
    font-size: 12px;
    flex-shrink: 0;
  }

  /* Submodule & Nested Repository cards */
  .oc-submodule-box {
    padding: 12px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 30%, transparent);
    background: color-mix(in srgb, var(--surface-elevated, var(--oc-elevated)) 45%, transparent);
  }

  .oc-submodule-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .oc-submodule-title {
    font-weight: 600;
    font-size: 12.5px;
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-submodule-meta {
    font-size: 12px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    margin-top: 2px;
  }

  .oc-submodule-open-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: calc(var(--radius, 9px) - 2px);
    border: 1px solid color-mix(in srgb, var(--surface-foreground, var(--oc-fg)) 16%, transparent);
    background: var(--surface-elevated, var(--oc-elevated));
    font-size: 12px;
    font-weight: 500;
    color: var(--surface-foreground, var(--oc-fg));
    white-space: nowrap;
    flex-shrink: 0;
  }

  .oc-submodule-open-btn:hover {
    background: var(--interactive-hover, var(--oc-hover));
  }

  .oc-nested-repo-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 0;
  }

  .oc-nested-repo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px 6px;
  }

  .oc-nested-repo-header-text {
    min-width: 0;
    flex: 1 1 auto;
  }

  .oc-nested-repo-title {
    font-weight: 600;
    font-size: 12.5px;
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-nested-repo-desc {
    font-size: 12px;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-nested-repo-empty {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-nested-repo-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .oc-nested-repo-item {
    border-top: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 25%, transparent);
  }

  .oc-nested-repo-file-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    text-align: left;
    font-size: 12.5px;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-nested-repo-file-btn:hover {
    background: color-mix(in srgb, var(--interactive-hover, var(--oc-hover)) 50%, transparent);
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    padding: 4px;
    border-radius: var(--radius, 9px);
    border: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 80%, transparent);
    background: var(--surface-elevated, var(--oc-elevated));
    color: var(--surface-elevated-foreground, var(--oc-elevated-fg));
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.22), 0 2px 6px rgb(0 0 0 / 0.12);
    max-width: calc(100vw - 20px);
  }

  .oc-dropdown-menu--scope {
    width: 170px;
  }

  .oc-dropdown-menu--branch {
    width: 260px;
  }

  .oc-dropdown-menu--commit {
    width: min(420px, calc(100vw - 24px));
  }

  .oc-dropdown-search-wrap {
    position: relative;
    display: flex;
    align-items: center;
    padding: 2px 2px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 45%, transparent);
    margin-bottom: 4px;
  }

  .oc-dropdown-search-icon {
    position: absolute;
    left: 10px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    pointer-events: none;
  }

  .oc-dropdown-search-input {
    width: 100%;
    height: 28px;
    padding: 0 8px 0 28px;
    border-radius: calc(var(--radius, 9px) - 3px);
    border: none;
    background: color-mix(in srgb, var(--surface-background, var(--oc-bg)) 60%, transparent);
    color: var(--surface-foreground, var(--oc-fg));
    font-size: 12.5px;
    outline: none;
  }

  .oc-dropdown-list {
    display: flex;
    flex-direction: column;
    max-height: 260px;
    overflow-y: auto;
  }

  .oc-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: calc(var(--radius, 9px) - 3px);
    font-size: 12.5px;
    text-align: left;
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-dropdown-item--active,
  .oc-dropdown-item:hover {
    background: var(--interactive-hover, var(--oc-hover));
  }

  .oc-dropdown-item-check {
    width: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .oc-dropdown-item-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .oc-dropdown-item-meta {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    font-variant-numeric: tabular-nums;
  }

  .oc-dropdown-item--commit {
    align-items: center;
    padding: 6px 8px;
  }

  .oc-commit-option-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .oc-commit-option-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .oc-commit-option-meta {
    font-size: 11.5px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .oc-dropdown-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 8px;
    font-size: 12px;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  /* Layout & Sidebars */
  .oc-diff-layout {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  .oc-tree-sidebar {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    max-width: 50%;
    height: 100%;
    overflow: hidden;
  }

  .oc-tree-resizer {
    position: relative;
    width: 1px;
    flex-shrink: 0;
    cursor: col-resize;
    background: color-mix(in srgb, var(--interactive-border, var(--oc-border)) 45%, transparent);
  }

  .oc-tree-resizer::before {
    content: '';
    position: absolute;
    inset: 0 -4px;
  }

  .oc-tree-resizer:hover {
    background: var(--interactive-selection, var(--oc-selection));
  }

  .oc-flat-sidebar {
    display: flex;
    flex-direction: column;
    width: 268px;
    flex-shrink: 0;
    margin: 8px 0 8px 10px;
    border-radius: var(--radius, 9px);
    border: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 50%, transparent);
    background: color-mix(in srgb, var(--surface-background, var(--oc-bg)) 70%, transparent);
    overflow: hidden;
  }

  .oc-flat-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 35%, transparent);
    font-weight: 600;
    font-size: 12.5px;
  }

  .oc-flat-sidebar-count {
    font-size: 12px;
    font-weight: 400;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-file-list-scroll,
  .oc-file-tree-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }

  .oc-file-list,
  .oc-file-tree {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .oc-file-row,
  .oc-tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    border-radius: calc(var(--radius, 9px) - 3px);
    text-align: left;
    color: var(--surface-muted-foreground, var(--oc-muted));
    font-size: 12.5px;
  }

  .oc-file-row:hover,
  .oc-tree-row:hover {
    background: var(--interactive-hover, var(--oc-hover));
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-file-row--active,
  .oc-tree-row--active {
    background: var(--interactive-selection, var(--oc-selection));
    color: var(--interactive-selection-foreground, var(--oc-selection-fg));
  }

  .oc-file-row-path,
  .oc-tree-row-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .oc-tree-row-end {
    margin-left: auto;
    padding-left: 4px;
    flex-shrink: 0;
  }

  .oc-status-letter {
    display: inline-block;
    width: 14px;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .oc-diff-totals {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Main Diff Scroll */
  .oc-diff-main {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  .oc-diff-scroll {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    overflow-anchor: none;
  }

  .oc-diff-scroll-content {
    display: flex;
    flex-direction: column;
    padding-bottom: 48px;
    overflow-anchor: none;
  }

  /* Find bar */
  .oc-find-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 50%, transparent);
    background: var(--surface-elevated, var(--oc-elevated));
    flex-shrink: 0;
  }

  .oc-find-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    border-radius: calc(var(--radius, 9px) - 3px);
    border: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 60%, transparent);
    background: var(--surface-background, var(--oc-bg));
    font-size: 12.5px;
    outline: none;
  }

  .oc-find-count {
    font-size: 11.5px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  }

  /* File Diff Entry */
  .oc-diff-entry {
    border-bottom: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 40%, transparent);
  }

  .oc-diff-entry:last-child {
    border-bottom: none;
  }

  .oc-diff-entry-header-sticky {
    position: sticky;
    top: 0;
    z-index: 20;
    border-bottom: 1px solid color-mix(in srgb, var(--interactive-border, var(--oc-border)) 35%, transparent);
    background: color-mix(in srgb, var(--surface-elevated, var(--oc-elevated)) 92%, transparent);
    backdrop-filter: blur(8px);
  }

  .oc-diff-entry-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 12px;
    cursor: pointer;
    user-select: none;
  }

  .oc-diff-entry-header:hover {
    background: color-mix(in srgb, var(--interactive-hover, var(--oc-hover)) 50%, transparent);
  }

  .oc-diff-entry-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .oc-diff-entry-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    flex-shrink: 0;
  }

  .oc-diff-entry-path-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .oc-diff-entry-dir-split {
    display: flex;
    align-items: baseline;
    min-width: 0;
    overflow: hidden;
  }

  .oc-diff-entry-dirname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-diff-entry-slash-name {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .oc-diff-entry-slash {
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-diff-entry-filename {
    color: var(--surface-foreground, var(--oc-fg));
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .oc-diff-entry-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .oc-difft-lang-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: calc(var(--radius, 9px) - 4px);
    background: color-mix(in srgb, var(--surface-foreground, var(--oc-fg)) 7%, transparent);
    color: var(--surface-muted-foreground, var(--oc-muted));
    font-size: 11px;
    font-weight: 500;
    line-height: 16px;
    white-space: nowrap;
  }

  .oc-difft-warning {
    font-size: 11.5px;
    color: var(--status-warning, var(--oc-warning));
    white-space: nowrap;
  }

  .oc-diff-entry-body {
    position: relative;
    background: var(--surface-background, var(--oc-bg));
    overflow: clip;
  }

  .oc-diff-entry-placeholder {
    height: 140px;
    background: color-mix(in srgb, var(--surface-background, var(--oc-bg)) 50%, transparent);
  }

  .oc-diff-entry-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px 16px;
    font-size: 12.5px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    text-align: center;
  }

  .oc-diff-entry-status--col {
    flex-direction: column;
    gap: 6px;
  }

  .oc-diff-entry-status-title {
    font-weight: 600;
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-diff-entry-status-desc {
    max-width: 480px;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-diff-empty {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--surface-muted-foreground, var(--oc-muted));
    font-size: 13px;
    text-align: center;
  }

  .oc-diff-empty--col {
    flex-direction: column;
    gap: 6px;
  }

  .oc-diff-empty-title {
    font-weight: 600;
    color: var(--surface-foreground, var(--oc-fg));
  }

  .oc-diff-empty-desc {
    max-width: 420px;
    font-size: 12px;
  }

  .oc-link-btn {
    color: var(--primary-text, var(--primary, currentColor));
    font-weight: 500;
    font-size: 12.5px;
  }

  .oc-link-btn:hover {
    text-decoration: underline;
  }

  .oc-pierre-viewer-root,
  .oc-pierre-viewer-container {
    width: 100%;
  }

  .oc-image-diff-wrap {
    width: 100%;
    overflow: auto;
    padding: 16px;
  }

  .oc-image-diff-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
  }

  .oc-image-diff-grid--split {
    flex-direction: row;
    gap: 24px;
    align-items: flex-start;
    justify-content: center;
  }

  .oc-image-diff-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex: 1 1 0;
    min-width: 0;
  }

  .oc-image-diff-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--surface-muted-foreground, var(--oc-muted));
  }

  .oc-image-diff-img {
    max-width: 100%;
    max-height: 65vh;
    object-fit: contain;
    border-radius: calc(var(--radius, 9px) - 3px);
  }
`;
