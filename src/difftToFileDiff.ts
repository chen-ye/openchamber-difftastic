import {
  parseDiffFromFile,
  SPLIT_WITH_NEWLINES,
  type ChangeContent,
  type ChangeTypes,
  type ContextContent,
  type FileDiffMetadata,
  type Hunk,
} from '@pierre/diffs';
import type {
  DifftChangeToken,
  DifftFileDecorations,
  DifftJsonFile,
  DifftLineSpan,
} from './types';

export const DEFAULT_CONTEXT_LINES = 3;

const splitFileContents = (contents: string): string[] =>
  contents !== '' ? contents.split(SPLIT_WITH_NEWLINES) : [];

type HunkBlock = ContextContent | ChangeContent;

type FileSegment =
  | {
      kind: 'context';
      oldStart: number;
      newStart: number;
      lines: number;
    }
  | {
      kind: 'change';
      oldStart: number;
      deletions: number;
      newStart: number;
      additions: number;
      structural: boolean;
    };

const stripLineEnding = (line: string): string => line.replace(/\r?\n$/, '');

const hasTrailingNewline = (text: string): boolean => text.length === 0 || text.endsWith('\n');

/**
 * Converts Difftastic's 0-based UTF-8 byte offsets `[start, end)` within a line
 * into UTF-16 code unit spans `{ spanStart, spanLength }` matching DOM Text nodes.
 */
export const byteOffsetsToCharSpans = (
  rawLine: string,
  tokens: readonly DifftChangeToken[],
): DifftLineSpan[] => {
  if (tokens.length === 0) return [];
  const line = stripLineEnding(rawLine);
  if (line.length === 0) return [];

  // Build a map from UTF-8 byte offset -> UTF-16 code unit index.
  const byteToChar: number[] = [];
  let charIndex = 0;
  for (const codePointChar of line) {
    const codePoint = codePointChar.codePointAt(0) ?? 0;
    const byteLength =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    for (let b = 0; b < byteLength; b += 1) {
      byteToChar.push(charIndex);
    }
    charIndex += codePointChar.length;
  }
  const totalBytes = byteToChar.length;
  byteToChar.push(line.length);

  const spans: DifftLineSpan[] = [];
  for (const token of tokens) {
    const startByte = Math.max(0, Math.min(token.start, totalBytes));
    const endByte = Math.max(startByte, Math.min(token.end, totalBytes));
    const spanStart = byteToChar[startByte] ?? 0;
    const spanEnd = byteToChar[endByte] ?? line.length;
    const spanLength = spanEnd - spanStart;
    if (spanLength <= 0) continue;

    const previous = spans.at(-1);
    if (
      previous &&
      previous.highlight === token.highlight &&
      previous.spanStart + previous.spanLength === spanStart
    ) {
      previous.spanLength += spanLength;
      previous.content += token.content;
      continue;
    }

    spans.push({
      spanStart,
      spanLength,
      highlight: token.highlight || 'normal',
      content: token.content,
    });
  }

  return spans;
};

const extractDifftDecorations = (
  oldLines: readonly string[],
  newLines: readonly string[],
  difft: DifftJsonFile | null,
): DifftFileDecorations => {
  const deletionSpans = new Map<number, DifftLineSpan[]>();
  const additionSpans = new Map<number, DifftLineSpan[]>();
  const changedOldLines = new Set<number>();
  const changedNewLines = new Set<number>();

  for (const chunk of difft?.chunks ?? []) {
    for (const entry of chunk) {
      if (entry.lhs) {
        const lineIndex = entry.lhs.line_number;
        const lineNumber = lineIndex + 1;
        changedOldLines.add(lineIndex);
        const spans = byteOffsetsToCharSpans(oldLines[lineIndex] ?? '', entry.lhs.changes);
        if (spans.length > 0) {
          const existing = deletionSpans.get(lineNumber);
          if (existing) existing.push(...spans);
          else deletionSpans.set(lineNumber, spans);
        }
      }
      if (entry.rhs) {
        const lineIndex = entry.rhs.line_number;
        const lineNumber = lineIndex + 1;
        changedNewLines.add(lineIndex);
        const spans = byteOffsetsToCharSpans(newLines[lineIndex] ?? '', entry.rhs.changes);
        if (spans.length > 0) {
          const existing = additionSpans.get(lineNumber);
          if (existing) existing.push(...spans);
          else additionSpans.set(lineNumber, spans);
        }
      }
    }
  }

  if (difft?.status === 'created') {
    return {
      language: difft.language || 'Text',
      status: 'created',
      deletionSpans,
      additionSpans,
      structuralAdditions: newLines.length,
      structuralDeletions: 0,
    };
  }

  if (difft?.status === 'deleted') {
    return {
      language: difft.language || 'Text',
      status: 'deleted',
      deletionSpans,
      additionSpans,
      structuralAdditions: 0,
      structuralDeletions: oldLines.length,
    };
  }

  return {
    language: difft?.language || 'Text',
    status: difft?.status ?? 'changed',
    deletionSpans,
    additionSpans,
    structuralAdditions: changedNewLines.size,
    structuralDeletions: changedOldLines.size,
  };
};

const resolveChangeType = (
  filePath: string,
  previousPath: string | undefined,
  original: string,
  modified: string,
  difft: DifftJsonFile | null,
): ChangeTypes => {
  if (difft?.status === 'created' || (original === '' && modified !== '')) return 'new';
  if (difft?.status === 'deleted' || (original !== '' && modified === '')) return 'deleted';
  if (previousPath && previousPath !== filePath) {
    return original === modified ? 'rename-pure' : 'rename-changed';
  }
  return 'change';
};

const MAX_ALIGNMENT_CELLS = 1_000_000;

/**
 * Aligns two slices of untouched line indices `oldIndices` and `newIndices`
 * where lines match when their stripped text is equal. Uses prefix/suffix
 * trimming, unique-line Patience anchors for large spans, and DP LCS.
 */
const alignUntouchedIndices = (
  oldLines: readonly string[],
  newLines: readonly string[],
  oldIndices: readonly number[],
  newIndices: readonly number[],
): Array<[number, number]> => {
  if (oldIndices.length === 0 || newIndices.length === 0) return [];

  let prefix = 0;
  while (
    prefix < oldIndices.length &&
    prefix < newIndices.length &&
    stripLineEnding(oldLines[oldIndices[prefix]!] ?? '') ===
      stripLineEnding(newLines[newIndices[prefix]!] ?? '')
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldIndices.length - prefix &&
    suffix < newIndices.length - prefix &&
    stripLineEnding(oldLines[oldIndices[oldIndices.length - 1 - suffix]!] ?? '') ===
      stripLineEnding(newLines[newIndices[newIndices.length - 1 - suffix]!] ?? '')
  ) {
    suffix += 1;
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < prefix; i += 1) {
    pairs.push([oldIndices[i]!, newIndices[i]!]);
  }

  const midOld = oldIndices.slice(prefix, oldIndices.length - suffix);
  const midNew = newIndices.slice(prefix, newIndices.length - suffix);
  const rows = midOld.length;
  const columns = midNew.length;

  if (rows > 0 && columns > 0) {
    const a = midOld.map((idx) => stripLineEnding(oldLines[idx] ?? ''));
    const b = midNew.map((idx) => stripLineEnding(newLines[idx] ?? ''));

    if (rows === columns && a.every((text, i) => text === b[i])) {
      for (let i = 0; i < rows; i += 1) {
        pairs.push([midOld[i]!, midNew[i]!]);
      }
    } else if ((rows + 1) * (columns + 1) <= MAX_ALIGNMENT_CELLS) {
      const width = columns + 1;
      const lengths = new Uint32Array((rows + 1) * width);
      for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = columns - 1; j >= 0; j -= 1) {
          lengths[i * width + j] =
            a[i] === b[j]
              ? lengths[(i + 1) * width + j + 1]! + 1
              : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
        }
      }
      let i = 0;
      let j = 0;
      while (i < rows && j < columns) {
        if (a[i] === b[j]) {
          pairs.push([midOld[i]!, midNew[j]!]);
          i += 1;
          j += 1;
        } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
          i += 1;
        } else {
          j += 1;
        }
      }
    } else {
      // Fallback for huge files: greedy monotonic match on unique/equal lines
      let jStart = 0;
      for (let i = 0; i < rows && jStart < columns; i += 1) {
        if (a[i] === b[jStart]) {
          pairs.push([midOld[i]!, midNew[jStart]!]);
          jStart += 1;
        }
      }
    }
  }

  for (let k = suffix; k > 0; k -= 1) {
    pairs.push([
      oldIndices[oldIndices.length - k]!,
      newIndices[newIndices.length - k]!,
    ]);
  }

  return pairs;
};

/**
 * Builds monotonic 1-to-1 unchanged line anchors `[oldIndex, newIndex]` from
 * Difftastic's `aligned_lines` and `chunks`, aligning all untouched lines
 * between chunks even when `aligned_lines` is omitted by `difft --display=json`.
 */
const buildUnchangedAnchors = (
  oldLines: readonly string[],
  newLines: readonly string[],
  difft: DifftJsonFile,
): Array<[number, number]> => {
  const changedOld = new Set<number>();
  const changedNew = new Set<number>();
  for (const chunk of difft.chunks ?? []) {
    for (const entry of chunk) {
      if (entry.lhs) changedOld.add(entry.lhs.line_number);
      if (entry.rhs) changedNew.add(entry.rhs.line_number);
    }
  }

  const rawAnchors: Array<[number, number]> = [];
  let lastOld = -1;
  let lastNew = -1;
  for (const [oldIdx, newIdx] of difft.aligned_lines ?? []) {
    if (oldIdx === null || newIdx === null) continue;
    if (oldIdx <= lastOld || newIdx <= lastNew) continue;
    if (oldIdx >= oldLines.length || newIdx >= newLines.length) continue;
    if (changedOld.has(oldIdx) || changedNew.has(newIdx)) continue;
    rawAnchors.push([oldIdx, newIdx]);
    lastOld = oldIdx;
    lastNew = newIdx;
  }

  const refined: Array<[number, number]> = [];
  const withSentinels: Array<[number, number]> = [
    ...rawAnchors,
    [oldLines.length, newLines.length],
  ];
  let prevO = -1;
  let prevN = -1;
  for (const [targetO, targetN] of withSentinels) {
    const untouchedOld: number[] = [];
    for (let o = prevO + 1; o < targetO; o += 1) {
      if (!changedOld.has(o)) untouchedOld.push(o);
    }
    const untouchedNew: number[] = [];
    for (let n = prevN + 1; n < targetN; n += 1) {
      if (!changedNew.has(n)) untouchedNew.push(n);
    }

    refined.push(...alignUntouchedIndices(oldLines, newLines, untouchedOld, untouchedNew));

    if (targetO < oldLines.length && targetN < newLines.length) {
      refined.push([targetO, targetN]);
    }
    prevO = targetO;
    prevN = targetN;
  }

  return refined;
};

const pushSegment = (segments: FileSegment[], next: FileSegment): void => {
  const prev = segments.at(-1);
  if (prev?.kind === 'context' && next.kind === 'context') {
    prev.lines += next.lines;
    return;
  }
  if (
    prev?.kind === 'change' &&
    next.kind === 'change' &&
    prev.structural === next.structural
  ) {
    prev.deletions += next.deletions;
    prev.additions += next.additions;
    return;
  }
  segments.push(next);
};

const buildFileSegments = (
  oldLines: readonly string[],
  newLines: readonly string[],
  difft: DifftJsonFile,
): FileSegment[] => {
  const changedOld = new Set<number>();
  const changedNew = new Set<number>();
  for (const chunk of difft.chunks ?? []) {
    for (const entry of chunk) {
      if (entry.lhs) changedOld.add(entry.lhs.line_number);
      if (entry.rhs) changedNew.add(entry.rhs.line_number);
    }
  }

  const anchors = buildUnchangedAnchors(oldLines, newLines, difft);
  const allPoints: Array<[number, number]> = [...anchors, [oldLines.length, newLines.length]];
  const segments: FileSegment[] = [];

  let prevO = -1;
  let prevN = -1;
  for (const [o, n] of allPoints) {
    const deletions = o - prevO - 1;
    const additions = n - prevN - 1;
    if (deletions > 0 || additions > 0) {
      const oldStart = prevO + 1;
      const newStart = prevN + 1;
      let structural = false;
      for (let i = oldStart; i < oldStart + deletions; i += 1) {
        if (changedOld.has(i)) {
          structural = true;
          break;
        }
      }
      if (!structural) {
        for (let j = newStart; j < newStart + additions; j += 1) {
          if (changedNew.has(j)) {
            structural = true;
            break;
          }
        }
      }

      if (!structural && deletions === additions) {
        // Equal line count with no AST changes (e.g. whitespace or ignored comment change):
        // render as unchanged context so line numbers stay 1:1 without false diff noise.
        pushSegment(segments, {
          kind: 'context',
          oldStart,
          newStart,
          lines: deletions,
        });
      } else {
        pushSegment(segments, {
          kind: 'change',
          oldStart,
          deletions,
          newStart,
          additions,
          structural,
        });
      }
    }

    if (o < oldLines.length && n < newLines.length) {
      pushSegment(segments, {
        kind: 'context',
        oldStart: o,
        newStart: n,
        lines: 1,
      });
    }
    prevO = o;
    prevN = n;
  }

  return segments;
};

const sideStart = (zeroBasedIndex: number, count: number): number =>
  zeroBasedIndex + (count === 0 ? 0 : 1);

const sideStartBoundary = (start: number, count: number): number =>
  start - (count === 0 ? 0 : 1);

/**
 * Cuts file segments into hunks around structural changes with `contextLines`
 * of context, copying each hunk's lines into partial `deletionLines` and
 * `additionLines` arrays so `@pierre/diffs` renders exact 1-based line numbers
 * even when Difftastic aligns unequal line counts outside hunks.
 */
const buildHunksFromSegments = (
  oldLines: readonly string[],
  newLines: readonly string[],
  segments: readonly FileSegment[],
  contextLines: number,
  fullContext: boolean,
  noEOFCRDeletionsFile: boolean,
  noEOFCRAdditionsFile: boolean,
): Pick<FileDiffMetadata, 'hunks' | 'deletionLines' | 'additionLines' | 'splitLineCount' | 'unifiedLineCount'> => {
  const hasAnyStructural = segments.some((seg) => seg.kind === 'change' && seg.structural);
  if (!hasAnyStructural) {
    return {
      hunks: [],
      deletionLines: [],
      additionLines: [],
      splitLineCount: 0,
      unifiedLineCount: 0,
    };
  }

  // Group segments into hunk slices.
  const pieces: FileSegment[][] = [];
  if (fullContext) {
    pieces.push([...segments]);
  } else {
    let current: FileSegment[] | null = null;
    for (let index = 0; index < segments.length; index += 1) {
      const seg = segments[index];
      const isStructuralChange = seg.kind === 'change' && seg.structural;

      if (isStructuralChange) {
        if (!current) {
          current = [];
          const prev = segments[index - 1];
          if (prev?.kind === 'context' && contextLines > 0) {
            const keep = Math.min(prev.lines, contextLines);
            current.push({
              kind: 'context',
              oldStart: prev.oldStart + (prev.lines - keep),
              newStart: prev.newStart + (prev.lines - keep),
              lines: keep,
            });
          }
        }
        current.push(seg);
        continue;
      }

      if (!current) continue;

      // Look ahead for the next structural change.
      let linesUntilNextStructural = 0;
      let foundNextStructural = false;
      for (let look = index; look < segments.length; look += 1) {
        const candidate = segments[look];
        if (candidate.kind === 'change' && candidate.structural) {
          foundNextStructural = true;
          break;
        }
        linesUntilNextStructural +=
          candidate.kind === 'context'
            ? candidate.lines
            : Math.max(candidate.deletions, candidate.additions);
      }

      if (foundNextStructural && linesUntilNextStructural <= contextLines * 2) {
        current.push(seg);
        continue;
      }

      if (seg.kind === 'context' && contextLines > 0) {
        const keep = Math.min(seg.lines, contextLines);
        current.push({
          kind: 'context',
          oldStart: seg.oldStart,
          newStart: seg.newStart,
          lines: keep,
        });
      }
      pieces.push(current);
      current = null;
    }
    if (current) pieces.push(current);
  }

  const deletionLines: string[] = [];
  const additionLines: string[] = [];
  const hunks: Hunk[] = [];
  let totalSplitLines = 0;
  let totalUnifiedLines = 0;
  let lastNewEnd = 0;

  for (const piece of pieces) {
    const first = piece[0];
    if (!first) continue;

    const hunkDeletionLineIndex = deletionLines.length;
    const hunkAdditionLineIndex = additionLines.length;
    const hunkBlocks: HunkBlock[] = [];

    let hunkAdditionLines = 0;
    let hunkDeletionLines = 0;
    let hunkContextLines = 0;
    let hunkSplitCount = 0;
    let hunkUnifiedCount = 0;

    let oldEnd = first.oldStart;
    let newEnd = first.newStart;

    for (const seg of piece) {
      const blockDelIndex = deletionLines.length;
      const blockAddIndex = additionLines.length;

      if (seg.kind === 'context') {
        for (let i = 0; i < seg.lines; i += 1) {
          deletionLines.push(oldLines[seg.oldStart + i] ?? '');
          additionLines.push(newLines[seg.newStart + i] ?? '');
        }
        hunkBlocks.push({
          type: 'context',
          lines: seg.lines,
          deletionLineIndex: blockDelIndex,
          additionLineIndex: blockAddIndex,
        });
        hunkContextLines += seg.lines;
        hunkSplitCount += seg.lines;
        hunkUnifiedCount += seg.lines;
        oldEnd = seg.oldStart + seg.lines;
        newEnd = seg.newStart + seg.lines;
      } else {
        for (let i = 0; i < seg.deletions; i += 1) {
          deletionLines.push(oldLines[seg.oldStart + i] ?? '');
        }
        for (let j = 0; j < seg.additions; j += 1) {
          additionLines.push(newLines[seg.newStart + j] ?? '');
        }
        hunkBlocks.push({
          type: 'change',
          deletions: seg.deletions,
          deletionLineIndex: blockDelIndex,
          additions: seg.additions,
          additionLineIndex: blockAddIndex,
        });
        hunkDeletionLines += seg.deletions;
        hunkAdditionLines += seg.additions;
        hunkSplitCount += Math.max(seg.deletions, seg.additions);
        hunkUnifiedCount += seg.deletions + seg.additions;
        oldEnd = seg.oldStart + seg.deletions;
        newEnd = seg.newStart + seg.additions;
      }
    }

    const deletionCount = hunkContextLines + hunkDeletionLines;
    const additionCount = hunkContextLines + hunkAdditionLines;
    const deletionStart = sideStart(first.oldStart, deletionCount);
    const additionStart = sideStart(first.newStart, additionCount);
    const collapsedBefore = Math.max(sideStartBoundary(additionStart, additionCount) - lastNewEnd, 0);
    const splitLineStart = totalSplitLines + collapsedBefore;
    const unifiedLineStart = totalUnifiedLines + collapsedBefore;

    totalSplitLines += collapsedBefore + hunkSplitCount;
    totalUnifiedLines += collapsedBefore + hunkUnifiedCount;
    lastNewEnd = newEnd;

    const endsOldFile = oldEnd === oldLines.length && oldLines.length > 0;
    const endsNewFile = newEnd === newLines.length && newLines.length > 0;

    hunks.push({
      collapsedBefore,
      additionStart,
      additionCount,
      additionLines: hunkAdditionLines,
      additionLineIndex: hunkAdditionLineIndex,
      deletionStart,
      deletionCount,
      deletionLines: hunkDeletionLines,
      deletionLineIndex: hunkDeletionLineIndex,
      hunkContent: hunkBlocks,
      hunkSpecs: `@@ -${deletionStart},${deletionCount} +${additionStart},${additionCount} @@\n`,
      splitLineStart,
      splitLineCount: hunkSplitCount,
      unifiedLineStart,
      unifiedLineCount: hunkUnifiedCount,
      noEOFCRDeletions: endsOldFile && noEOFCRDeletionsFile,
      noEOFCRAdditions: endsNewFile && noEOFCRAdditionsFile,
    });
  }

  return {
    hunks,
    deletionLines,
    additionLines,
    splitLineCount: totalSplitLines,
    unifiedLineCount: totalUnifiedLines,
  };
};

export interface DifftAdaptedViewModel {
  fileDiff: FileDiffMetadata;
  fallbackFileDiff: FileDiffMetadata;
  difftDecorations: DifftFileDecorations;
}

export const adaptDifftToViewModel = (params: {
  filePath: string;
  previousPath?: string;
  original: string;
  modified: string;
  difft: DifftJsonFile | null;
  contextLines?: number;
  fullContext?: boolean;
}): DifftAdaptedViewModel => {
  const {
    filePath,
    previousPath,
    original,
    modified,
    difft,
    contextLines = DEFAULT_CONTEXT_LINES,
    fullContext = false,
  } = params;

  const oldLines = splitFileContents(original);
  const newLines = splitFileContents(modified);
  const difftDecorations = extractDifftDecorations(oldLines, newLines, difft);
  const changeType = resolveChangeType(filePath, previousPath, original, modified, difft);

  const fallbackFileDiff =
    changeType === 'new'
      ? parseDiffFromFile(null, { name: filePath, contents: modified })
      : changeType === 'deleted'
        ? parseDiffFromFile({ name: previousPath ?? filePath, contents: original }, null)
        : parseDiffFromFile(
            { name: previousPath ?? filePath, contents: original },
            { name: filePath, contents: modified },
          );

  if (changeType === 'new' || changeType === 'deleted' || !difft) {
    return {
      fileDiff: fallbackFileDiff,
      fallbackFileDiff,
      difftDecorations,
    };
  }

  const segments = buildFileSegments(oldLines, newLines, difft);
  const noEOFCRDeletionsFile = !hasTrailingNewline(original);
  const noEOFCRAdditionsFile = !hasTrailingNewline(modified);
  const built = buildHunksFromSegments(
    oldLines,
    newLines,
    segments,
    contextLines,
    fullContext,
    noEOFCRDeletionsFile,
    noEOFCRAdditionsFile,
  );

  const deletionCharacterCount = built.deletionLines.reduce((sum, line) => sum + line.length, 0);
  const additionCharacterCount = built.additionLines.reduce((sum, line) => sum + line.length, 0);

  const fileDiff: FileDiffMetadata = {
    name: filePath,
    prevName: previousPath && previousPath !== filePath ? previousPath : undefined,
    type: changeType,
    hunks: built.hunks,
    splitLineCount: built.splitLineCount,
    unifiedLineCount: built.unifiedLineCount,
    // Keep `isPartial: true` so @pierre/diffs uses the hunk-indexed line arrays
    // and never asserts equal trailing line counts when Difftastic aligns wrapped lines.
    isPartial: true,
    deletionLines: built.deletionLines,
    additionLines: built.additionLines,
    deletionCharacterCount,
    additionCharacterCount,
    cacheKey: `difft:${filePath}:${fullContext ? 'full' : contextLines}:${original.length}:${modified.length}:${built.hunks.length}`,
  };

  return {
    fileDiff,
    fallbackFileDiff,
    difftDecorations,
  };
};
