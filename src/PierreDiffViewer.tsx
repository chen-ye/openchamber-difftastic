import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import {
  areOptionsEqual,
  FileDiff as PierreFileDiff,
  VirtualizedFileDiff,
  Virtualizer,
  type FileDiffMetadata,
  type FileDiffOptions,
  type DiffLineAnnotation,
  type ExpansionDirections,
  type VirtualFileMetrics,
} from '@pierre/diffs';
import { DIFFS_HIGHLIGHTER } from './pierreTheme';
import type { DifftFileDecorations, DifftLineSpan } from './types';

export type DiffFindSide = 'deletions' | 'additions';

export type ContextExpansionRequest =
  | { gap: 'before-hunk'; additionStart: number; direction: ExpansionDirections }
  | { gap: 'after-last-hunk' };

type DiffAnnotation = { type: 'trailing-expand' };

const DIFFT_TOKEN_ATTR = 'data-difft-token';
const DIFFT_HIGHLIGHT_ATTR = 'data-difft-highlight';
const FIND_MARK_ATTR = 'data-oc-find-mark';
const FIND_CURRENT_ATTR = 'data-oc-find-current';
const FIND_STYLE_ATTR = 'data-oc-find-style';
const PATCH_CONTEXT_LINES = 3;

const FIND_MARK_CSS = `
  mark[${FIND_MARK_ATTR}] { background-color: color-mix(in srgb, var(--status-warning) 30%, transparent); color: inherit; border-radius: 2px; }
  mark[${FIND_CURRENT_ATTR}] { background-color: color-mix(in srgb, var(--status-warning) 60%, transparent); }
`;

const PIERRE_DIFF_TINT_CSS = `
  [data-line][data-line-type],
  [data-no-newline][data-line-type] {
    --mix-light: 94%;
    --mix-dark: 90%;
  }

  [data-gutter-buffer][data-line-type],
  [data-column-number][data-line-type] {
    --mix-light: 95%;
    --mix-dark: 92%;
  }

  [data-diff-span] {
    --diffs-bg-addition-emphasis: light-dark(
      rgb(from var(--diffs-addition-base) r g b / 0.16),
      rgb(from var(--diffs-addition-base) r g b / 0.24)
    );
    --diffs-bg-deletion-emphasis: light-dark(
      rgb(from var(--diffs-deletion-base) r g b / 0.16),
      rgb(from var(--diffs-deletion-base) r g b / 0.24)
    );
    border-radius: 2px;
    font-weight: 600;
  }
`;

const PIERRE_RUNTIME_BASE_CSS = `
  :host {
    font-family: var(--font-mono);
    font-size: var(--text-code, 12.5px);
    --diffs-bg-separator-override: var(--surface-elevated);
  }

  pre, [data-code] {
    font-family: var(--font-mono);
    font-size: var(--text-code, 12.5px);
  }

  [data-line-number] {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  [data-diff-header],
  [data-diff] {
    [data-separator] {
      height: 24px !important;
    }
  }

  [data-separator="line-info-basic"] {
    height: 24px !important;
    background: color-mix(in srgb, var(--diffs-fg) 2%, var(--diffs-bg)) !important;
    position: relative;
    box-shadow:
      inset 0 1px 0 var(--interactive-border),
      inset 0 -1px 0 var(--interactive-border);
  }

  [data-separator="line-info-basic"][data-separator-first] {
    box-shadow: inset 0 -1px 0 var(--interactive-border);
  }

  [data-separator="line-info-basic"][data-separator-last] {
    box-shadow: inset 0 1px 0 var(--interactive-border);
  }

  [data-diff-type="single"] [data-gutter],
  [data-diff-type="split"] [data-deletions] [data-gutter] {
    [data-separator-wrapper] {
      position: absolute;
      left: 100%;
      display: flex;
      align-items: center;
      gap: unset;
      width: max-content;
      background: transparent;
      color: var(--diffs-fg-number);
      font-family: var(--diffs-header-font-family, var(--font-sans));
      font-size: 0.75rem;
      line-height: 1;
      margin-left: calc(-2ch - 2px);
    }

    [data-expand-button],
    [data-separator-content] {
      display: block;
      align-self: unset;
      min-width: unset;
      min-height: unset;
      padding: 0;
      flex-shrink: 0;
      grid-column: unset;
      border: none;
      width: auto;
      height: auto;
      background-color: transparent;
      color: inherit;
      font: inherit;
    }

    [data-separator-content] {
      background: transparent;
      margin-left: calc(2px + 1ch);
    }
  }

  :host([data-oc-expand-on-demand]) [data-diff-type="single"] [data-gutter] [data-separator-wrapper],
  :host([data-oc-expand-on-demand]) [data-diff-type="split"] [data-deletions] [data-gutter] [data-separator-wrapper] {
    cursor: pointer;

    &::before {
      content: '\\2195';
      display: block;
      flex-shrink: 0;
    }

    &:hover {
      color: var(--diffs-fg);
    }
  }

  :host([data-oc-expand-on-demand]) [data-diff-type="single"] [data-gutter] [data-separator-first] [data-separator-wrapper]::before,
  :host([data-oc-expand-on-demand]) [data-diff-type="split"] [data-deletions] [data-gutter] [data-separator-first] [data-separator-wrapper]::before {
    content: '\\2191';
  }

  [data-oc-trailing-expand] {
    display: flex;
    width: 100%;
    height: 24px;
    align-items: center;
    padding: 0 12px;
    background: color-mix(in srgb, var(--diffs-fg) 2%, var(--diffs-bg));
    color: var(--diffs-fg-number);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    border: none;
    box-shadow: inset 0 1px 0 var(--interactive-border);
    cursor: pointer;
    text-align: left;
  }

  [data-oc-trailing-expand]:hover {
    color: var(--diffs-fg);
  }
`;

export interface PierreDiffViewerHandle {
  scrollToLine(target: {
    lineNumber: number;
    side: DiffFindSide;
    align?: 'start' | 'center';
  }): boolean;
  setFindHighlights(
    matches: ReadonlyArray<{
      lineNumber: number;
      side: DiffFindSide;
      spanStart: number;
      spanLength: number;
    }>,
    currentIndex: number,
  ): void;
}

export interface PierreDiffViewerProps {
  fileDiff: FileDiffMetadata;
  difftDecorations?: DifftFileDecorations;
  themeId: string;
  isDark: boolean;
  renderSideBySide: boolean;
  wrapLines: boolean;
  onExpandContextRequest?: (request: ContextExpansionRequest) => void;
}

const getDiffShadowRoot = (container: HTMLElement | null): ShadowRoot | null => {
  const host = container?.querySelector('diffs-container');
  return host?.shadowRoot ?? null;
};

const rowMatchesSide = (row: Element, side: DiffFindSide): boolean => {
  const lineType = row.getAttribute('data-line-type');
  if (lineType === 'deletion' || lineType === 'change-deletion') return side === 'deletions';
  if (lineType === 'addition' || lineType === 'change-addition') return side === 'additions';
  const column = row.closest('[data-deletions], [data-additions]');
  if (!column) return side === 'additions';
  return column.hasAttribute('data-deletions') ? side === 'deletions' : side === 'additions';
};

const rowTextNodes = (row: HTMLElement): Text[] => {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text) nodes.push(node);
  }
  return nodes;
};

const unwrapSelector = (root: ShadowRoot, selector: string): void => {
  const parents = new Set<Node>();
  root.querySelectorAll(selector).forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    el.replaceWith(...Array.from(el.childNodes));
    parents.add(parent);
  });
  parents.forEach((parent) => parent.normalize());
};

const wrapRowSpanWithElement = (
  row: HTMLElement,
  spanStart: number,
  spanLength: number,
  createWrapper: () => HTMLElement,
): void => {
  const end = spanStart + spanLength;
  let offset = 0;
  for (const node of rowTextNodes(row)) {
    const nodeStart = offset;
    const length = node.nodeValue?.length ?? 0;
    offset += length;
    const from = Math.max(spanStart, nodeStart) - nodeStart;
    const to = Math.min(end, nodeStart + length) - nodeStart;
    if (to <= from) continue;
    let segment = node;
    if (from > 0) segment = segment.splitText(from);
    if (to - from < segment.length) segment.splitText(to - from);
    const wrapper = createWrapper();
    segment.replaceWith(wrapper);
    wrapper.appendChild(segment);
    if (offset >= end) break;
  }
};

/**
 * Applies Difftastic's structural AST token spans (`lhs.changes` / `rhs.changes`)
 * as `[data-diff-span]` elements inside the rendered Pierre diff shadow root.
 */
const applyDifftSpansToContainer = (
  container: HTMLElement | null,
  decorations: DifftFileDecorations | undefined,
): void => {
  const root = getDiffShadowRoot(container);
  if (!root) return;
  unwrapSelector(root, `span[${DIFFT_TOKEN_ATTR}]`);
  if (!decorations) return;
  if (decorations.deletionSpans.size === 0 && decorations.additionSpans.size === 0) return;

  for (const row of root.querySelectorAll('[data-line]')) {
    if (!(row instanceof HTMLElement)) continue;
    const lineNumber = Number.parseInt(row.getAttribute('data-line') ?? '', 10);
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;

    const applyForSide = (side: DiffFindSide, spans: readonly DifftLineSpan[] | undefined) => {
      if (!spans || spans.length === 0) return;
      if (!rowMatchesSide(row, side)) return;
      for (const span of spans) {
        wrapRowSpanWithElement(row, span.spanStart, span.spanLength, () => {
          const el = document.createElement('span');
          el.setAttribute('data-diff-span', '');
          el.setAttribute(DIFFT_TOKEN_ATTR, 'true');
          el.setAttribute(DIFFT_HIGHLIGHT_ATTR, span.highlight);
          return el;
        });
      }
    };

    applyForSide('deletions', decorations.deletionSpans.get(lineNumber));
    applyForSide('additions', decorations.additionSpans.get(lineNumber));
  }
};

const ensureFindStyle = (root: ShadowRoot): void => {
  if (root.querySelector(`style[${FIND_STYLE_ATTR}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(FIND_STYLE_ATTR, '');
  style.textContent = FIND_MARK_CSS;
  root.appendChild(style);
};

const applyFindHighlightsToContainer = (
  container: HTMLElement | null,
  matches: ReadonlyArray<{
    lineNumber: number;
    side: DiffFindSide;
    spanStart: number;
    spanLength: number;
  }>,
  currentIndex: number,
): void => {
  const root = getDiffShadowRoot(container);
  if (!root) return;
  unwrapSelector(root, `mark[${FIND_MARK_ATTR}]`);
  if (matches.length === 0) {
    root.querySelector(`style[${FIND_STYLE_ATTR}]`)?.remove();
    return;
  }
  ensureFindStyle(root);
  const rowsByLine = new Map<string, HTMLElement[]>();
  for (const row of root.querySelectorAll('[data-line]')) {
    const line = row.getAttribute('data-line');
    if (line === null || !(row instanceof HTMLElement)) continue;
    const rows = rowsByLine.get(line);
    if (rows) rows.push(row);
    else rowsByLine.set(line, [row]);
  }
  matches.forEach((match, index) => {
    const isCurrent = index === currentIndex;
    for (const row of rowsByLine.get(String(match.lineNumber)) ?? []) {
      if (rowMatchesSide(row, match.side)) {
        wrapRowSpanWithElement(row, match.spanStart, match.spanLength, () => {
          const mark = document.createElement('mark');
          mark.setAttribute(FIND_MARK_ATTR, '');
          if (isCurrent) mark.setAttribute(FIND_CURRENT_ATTR, '');
          return mark;
        });
      }
    }
  });
};

const resolveContextExpansionRequest = (
  path: readonly EventTarget[],
  fileDiff: FileDiffMetadata,
): ContextExpansionRequest | null => {
  const separator = path.find(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.hasAttribute('data-separator'),
  );
  if (!separator) return null;

  let next: Element | null = separator.nextElementSibling;
  while (next && !next.hasAttribute('data-line-index')) next = next.nextElementSibling;
  const [unifiedRaw, splitRaw] = next?.getAttribute('data-line-index')?.split(',') ?? [];
  const unifiedIndex = Number.parseInt(unifiedRaw ?? '', 10);
  const splitIndex = Number.parseInt(splitRaw ?? '', 10);
  if (Number.isNaN(unifiedIndex) || Number.isNaN(splitIndex)) return null;

  const hunk = fileDiff.hunks.find(
    (candidate) =>
      candidate.unifiedLineStart <= unifiedIndex &&
      unifiedIndex < candidate.unifiedLineStart + candidate.unifiedLineCount &&
      candidate.splitLineStart <= splitIndex &&
      splitIndex < candidate.splitLineStart + candidate.splitLineCount,
  );
  if (!hunk) return null;

  return {
    gap: 'before-hunk',
    additionStart: hunk.additionStart,
    direction: separator.hasAttribute('data-separator-first') ? 'down' : 'both',
  };
};

const getTrailingExpandAnnotation = (
  fileDiff: FileDiffMetadata,
): DiffLineAnnotation<DiffAnnotation> | null => {
  if (fileDiff.type === 'new' || fileDiff.type === 'deleted') return null;
  const hunk = fileDiff.hunks.at(-1);
  const lastContent = hunk?.hunkContent.at(-1);
  if (!hunk || lastContent?.type !== 'context' || lastContent.lines < PATCH_CONTEXT_LINES) {
    return null;
  }
  if (hunk.noEOFCRAdditions || hunk.noEOFCRDeletions) return null;
  return {
    side: 'deletions',
    lineNumber: hunk.deletionStart + hunk.deletionCount - 1,
    metadata: { type: 'trailing-expand' },
  };
};

type SharedVirtualizer = {
  virtualizer: Virtualizer;
  release: () => void;
};

type VirtualizerEntry = {
  virtualizer: Virtualizer;
  refs: number;
};

const virtualizerCache = new WeakMap<Document | HTMLElement, VirtualizerEntry>();

const VIRTUAL_METRICS: Partial<VirtualFileMetrics> = {
  lineHeight: 24,
  hunkSeparatorHeight: 24,
  spacing: 0,
};

const acquireSharedVirtualizer = (container: HTMLElement): SharedVirtualizer | null => {
  if (typeof document === 'undefined') return null;
  const root = container.closest('[data-diff-virtual-root]');
  const targetRoot: Document | HTMLElement = root instanceof HTMLElement ? root : document;
  const content =
    root instanceof HTMLElement
      ? (root.querySelector('[data-diff-virtual-content]') as HTMLElement | null) ?? undefined
      : undefined;

  let entry = virtualizerCache.get(targetRoot);
  if (!entry) {
    const virtualizer = new Virtualizer();
    virtualizer.setup(targetRoot, content);
    entry = { virtualizer, refs: 0 };
    virtualizerCache.set(targetRoot, entry);
  }
  entry.refs += 1;

  let released = false;
  return {
    virtualizer: entry.virtualizer,
    release: () => {
      if (released) return;
      released = true;
      const current = virtualizerCache.get(targetRoot);
      if (!current) return;
      current.refs -= 1;
      if (current.refs <= 0) {
        current.virtualizer.cleanUp();
        virtualizerCache.delete(targetRoot);
      }
    },
  };
};

export const PierreDiffViewer = React.forwardRef<PierreDiffViewerHandle, PierreDiffViewerProps>(
  (
    {
      fileDiff,
      difftDecorations,
      themeId,
      isDark,
      renderSideBySide,
      wrapLines,
      onExpandContextRequest,
    },
    ref,
  ) => {
    const diffRootRef = useRef<HTMLDivElement | null>(null);
    const diffContainerRef = useRef<HTMLDivElement | null>(null);
    const diffInstanceRef = useRef<PierreFileDiff<DiffAnnotation> | null>(null);
    const sharedVirtualizerRef = useRef<SharedVirtualizer | null>(null);
    const instanceFileDiffRef = useRef<FileDiffMetadata | undefined>(undefined);
    const decorationsRef = useRef<DifftFileDecorations | undefined>(difftDecorations);
    decorationsRef.current = difftDecorations;

    const findMatchesRef = useRef<
      ReadonlyArray<{
        lineNumber: number;
        side: DiffFindSide;
        spanStart: number;
        spanLength: number;
      }>
    >([]);
    const findCurrentIndexRef = useRef(-1);
    const shadowObserverRef = useRef<MutationObserver | null>(null);
    const requestTrailingExpansionRef = useRef<() => void>(() => {});
    requestTrailingExpansionRef.current = () => {
      onExpandContextRequest?.({ gap: 'after-last-hunk' });
    };

    const applyOverlays = useCallback(() => {
      const observer = shadowObserverRef.current;
      observer?.takeRecords();
      const root = getDiffShadowRoot(diffContainerRef.current);
      if (root) {
        unwrapSelector(root, `mark[${FIND_MARK_ATTR}]`);
      }
      applyDifftSpansToContainer(diffContainerRef.current, decorationsRef.current);
      applyFindHighlightsToContainer(
        diffContainerRef.current,
        findMatchesRef.current,
        findCurrentIndexRef.current,
      );
      observer?.takeRecords();
    }, []);

    const setFindHighlights = useCallback(
      (
        matches: ReadonlyArray<{
          lineNumber: number;
          side: DiffFindSide;
          spanStart: number;
          spanLength: number;
        }>,
        currentIndex: number,
      ) => {
        findMatchesRef.current = matches;
        findCurrentIndexRef.current = currentIndex;
        applyOverlays();
      },
      [applyOverlays],
    );

    const scrollToLine = useCallback(
      (target: {
        lineNumber: number;
        side: DiffFindSide;
        align?: 'start' | 'center';
      }): boolean => {
        const { lineNumber, side, align = 'start' } = target;
        if (lineNumber < 1) return false;
        const root = getDiffShadowRoot(diffContainerRef.current);
        for (const row of root?.querySelectorAll(`[data-line="${lineNumber}"]`) ?? []) {
          if (!(row instanceof HTMLElement) || !rowMatchesSide(row, side)) continue;
          const activeMark = row.querySelector(`mark[${FIND_CURRENT_ATTR}]`) ?? row;
          activeMark.scrollIntoView({
            block: align === 'center' ? 'center' : 'start',
            inline: 'nearest',
          });
          return true;
        }
        return false;
      },
      [],
    );

    React.useImperativeHandle(ref, () => ({ scrollToLine, setFindHighlights }), [
      scrollToLine,
      setFindHighlights,
    ]);

    const expandOnDemand = Boolean(onExpandContextRequest) && fileDiff.isPartial;

    const renderAnnotation = useCallback((annotation: DiffLineAnnotation<DiffAnnotation>) => {
      const div = document.createElement('div');
      div.style.position = 'relative';
      if (annotation.metadata.type === 'trailing-expand') {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.ocTrailingExpand = '';
        button.textContent = '\u2193 Show full file context';
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          requestTrailingExpansionRef.current();
        });
        div.append(button);
      }
      return div;
    }, []);

    const handlePostRender = useCallback<
      NonNullable<FileDiffOptions<DiffAnnotation, undefined>['onPostRender']>
    >(
      (_node, _instance, phase) => {
        if (phase !== 'unmount') {
          applyOverlays();
        }
      },
      [applyOverlays],
    );

    const options = useMemo<FileDiffOptions<DiffAnnotation, undefined>>(
      () => ({
        theme: {
          dark: themeId,
          light: themeId,
        },
        themeType: isDark ? 'dark' : 'light',
        preferredHighlighter: DIFFS_HIGHLIGHTER,
        diffStyle: renderSideBySide ? 'split' : 'unified',
        diffIndicators: 'none',
        hunkSeparators: 'line-info-basic',
        lineDiffType: 'none',
        maxLineDiffLength: 1000,
        maxLineLengthForHighlighting: 1000,
        tokenizeMaxLineLength: 1000,
        collapsedContextThreshold: 0,
        expansionLineCount: 20,
        overflow: wrapLines ? 'wrap' : 'scroll',
        disableFileHeader: true,
        unsafeCSS: `${PIERRE_RUNTIME_BASE_CSS}\n${PIERRE_DIFF_TINT_CSS}`,
        renderAnnotation: expandOnDemand ? renderAnnotation : undefined,
        onPostRender: handlePostRender,
      }),
      [
        expandOnDemand,
        handlePostRender,
        isDark,
        renderAnnotation,
        renderSideBySide,
        themeId,
        wrapLines,
      ],
    );

    const lineAnnotations = useMemo<DiffLineAnnotation<DiffAnnotation>[]>(() => {
      const annotations: DiffLineAnnotation<DiffAnnotation>[] = [];
      const trailing = expandOnDemand ? getTrailingExpandAnnotation(fileDiff) : null;
      if (trailing) annotations.push(trailing);
      return annotations;
    }, [expandOnDemand, fileDiff]);

    useEffect(() => {
      const container = diffContainerRef.current;
      return () => {
        diffInstanceRef.current?.cleanUp();
        diffInstanceRef.current = null;
        sharedVirtualizerRef.current?.release();
        sharedVirtualizerRef.current = null;
        instanceFileDiffRef.current = undefined;
        if (container) container.innerHTML = '';
      };
    }, []);

    useEffect(() => {
      const container = diffContainerRef.current;
      if (!container) return;

      let sharedVirtualizer = sharedVirtualizerRef.current;
      if (!sharedVirtualizer) {
        sharedVirtualizer = acquireSharedVirtualizer(container);
        sharedVirtualizerRef.current = sharedVirtualizer;
      }

      const targetChanged = instanceFileDiffRef.current !== fileDiff;
      const currentInstance = diffInstanceRef.current;
      if (currentInstance && targetChanged) {
        currentInstance.cleanUp();
        diffInstanceRef.current = null;
        container.innerHTML = '';
      }

      let instance = diffInstanceRef.current;
      const forceRender =
        !targetChanged && currentInstance
          ? !areOptionsEqual(currentInstance.options, options)
          : false;

      if (!instance) {
        instance = sharedVirtualizer
          ? new VirtualizedFileDiff<DiffAnnotation>(
              options,
              sharedVirtualizer.virtualizer,
              VIRTUAL_METRICS,
            )
          : new PierreFileDiff<DiffAnnotation>(options);
        diffInstanceRef.current = instance;
      } else {
        instance.setOptions(options);
      }

      instanceFileDiffRef.current = fileDiff;
      instance.render({
        fileDiff,
        forceRender,
        lineAnnotations,
        containerWrapper: container,
      });

      const host = container.querySelector('diffs-container');
      if (host instanceof HTMLElement) {
        host.toggleAttribute('data-oc-expand-on-demand', expandOnDemand);
      }
      applyOverlays();
    }, [applyOverlays, expandOnDemand, fileDiff, lineAnnotations, options]);

    useEffect(() => {
      const container = diffContainerRef.current;
      if (!container) return;

      let observer: MutationObserver | null = null;
      let rafId: number | null = null;

      const setupObserver = () => {
        const diffsContainer = container.querySelector('diffs-container');
        if (!(diffsContainer instanceof HTMLElement)) return;
        const shadowRoot = diffsContainer.shadowRoot;
        const schedulePass = () => {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            rafId = null;
            const host = container.querySelector('diffs-container');
            if (host instanceof HTMLElement) {
              host.toggleAttribute('data-oc-expand-on-demand', expandOnDemand);
            }
            applyOverlays();
          });
        };
        observer = new MutationObserver(schedulePass);
        shadowObserverRef.current = observer;
        observer.observe(diffsContainer, { childList: true, subtree: true });
        if (shadowRoot) {
          observer.observe(shadowRoot, { childList: true, subtree: true });
        }
        applyOverlays();
      };

      const timeoutId = setTimeout(setupObserver, 50);
      return () => {
        clearTimeout(timeoutId);
        if (rafId) cancelAnimationFrame(rafId);
        observer?.disconnect();
        if (shadowObserverRef.current === observer) {
          shadowObserverRef.current = null;
        }
      };
    }, [applyOverlays, expandOnDemand, fileDiff]);

    useEffect(() => {
      const container = diffContainerRef.current;
      if (!container || !expandOnDemand || !onExpandContextRequest) return;

      const onClick = (event: MouseEvent) => {
        if (event.button !== 0) return;
        const request = resolveContextExpansionRequest(event.composedPath(), fileDiff);
        if (!request) return;
        event.preventDefault();
        event.stopPropagation();
        onExpandContextRequest(request);
      };

      container.addEventListener('click', onClick);
      return () => container.removeEventListener('click', onClick);
    }, [expandOnDemand, fileDiff, onExpandContextRequest]);

    return (
      <div ref={diffRootRef} className="oc-pierre-viewer-root">
        <div ref={diffContainerRef} className="oc-pierre-viewer-container" />
      </div>
    );
  },
);
