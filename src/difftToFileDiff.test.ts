import { describe, expect, test } from 'bun:test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiffHunksRenderer } from '@pierre/diffs';
import { OPENCHAMBER_SDK_API_VERSION } from '@openchamber/sdk';
import { adaptDifftToViewModel, byteOffsetsToCharSpans } from './difftToFileDiff';
import { buildDiffTreeRows } from './changesTree';
import { resolveBranchComparisonBase } from './baseBranch';
import { chooseAutoNestedRepo, discoversNestedRepos } from './nestedRepositories';
import type { DifftJsonFile } from './types';

describe('byteOffsetsToCharSpans', () => {
  test('converts UTF-8 byte offsets with multi-byte characters into UTF-16 character spans', () => {
    // "héllo" is 5 UTF-16 code units, 6 UTF-8 bytes ('é' is 2 bytes)
    const line = 'const msg = "héllo world";\n';
    const spans = byteOffsetsToCharSpans(line, [
      { start: 13, end: 19, content: 'héllo', highlight: 'string' },
      { start: 20, end: 25, content: 'world', highlight: 'string' },
    ]);

    expect(spans).toEqual([
      {
        spanStart: 13,
        spanLength: 5,
        highlight: 'string',
        content: 'héllo',
      },
      {
        spanStart: 19,
        spanLength: 5,
        highlight: 'string',
        content: 'world',
      },
    ]);
    expect(line.slice(spans[0]!.spanStart, spans[0]!.spanStart + spans[0]!.spanLength)).toBe(
      'héllo',
    );
    expect(line.slice(spans[1]!.spanStart, spans[1]!.spanStart + spans[1]!.spanLength)).toBe(
      'world',
    );
  });
});

describe('adaptDifftToViewModel', () => {
  test('adapts difftastic structured JSON into Pierre FileDiffMetadata and renders in both split and unified modes', () => {
    const original = [
      'line1',
      'line2',
      'function calc(x: number, y: number) {',
      '  const oldName = x + y;',
      '  const removed = 42;',
      '  return oldName;',
      '}',
      'line8',
      'line9',
      'line10',
      'line11',
      'line12',
      'const end = 1;',
      '',
    ].join('\n');

    const modified = [
      'line1',
      'line2',
      'function calc(x: number, y: number, z = 0) {',
      '  const newName = x + y + z;',
      '  return newName;',
      '}',
      'line8',
      'line9',
      'line10',
      'line11',
      'line12',
      'const end = 2;',
      '  const added = 99;',
      '',
    ].join('\n');

    const difft: DifftJsonFile = {
      aligned_lines: [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, null],
        [5, 4],
        [6, 5],
        [7, 6],
        [8, 7],
        [9, 8],
        [10, 9],
        [11, 10],
        [12, 11],
        [null, 12],
        [13, 13],
      ],
      chunks: [
        [
          {
            lhs: { line_number: 2, changes: [] },
            rhs: {
              line_number: 2,
              changes: [
                { start: 34, end: 35, content: ',', highlight: 'normal' },
                { start: 36, end: 37, content: 'z', highlight: 'normal' },
                { start: 38, end: 39, content: '=', highlight: 'keyword' },
                { start: 40, end: 41, content: '0', highlight: 'normal' },
              ],
            },
          },
          {
            lhs: {
              line_number: 3,
              changes: [{ start: 8, end: 15, content: 'oldName', highlight: 'normal' }],
            },
            rhs: {
              line_number: 3,
              changes: [
                { start: 8, end: 15, content: 'newName', highlight: 'normal' },
                { start: 24, end: 25, content: '+', highlight: 'keyword' },
                { start: 26, end: 27, content: 'z', highlight: 'normal' },
              ],
            },
          },
          {
            lhs: {
              line_number: 4,
              changes: [{ start: 2, end: 7, content: 'const', highlight: 'keyword' }],
            },
          },
          {
            lhs: {
              line_number: 5,
              changes: [{ start: 9, end: 16, content: 'oldName', highlight: 'normal' }],
            },
            rhs: {
              line_number: 4,
              changes: [{ start: 9, end: 16, content: 'newName', highlight: 'normal' }],
            },
          },
        ],
        [
          {
            rhs: {
              line_number: 12,
              changes: [{ start: 8, end: 13, content: 'added', highlight: 'normal' }],
            },
          },
          {
            lhs: {
              line_number: 12,
              changes: [{ start: 12, end: 13, content: '1', highlight: 'normal' }],
            },
            rhs: {
              line_number: 11,
              changes: [{ start: 12, end: 13, content: '2', highlight: 'normal' }],
            },
          },
        ],
      ],
      language: 'TypeScript',
      path: 'src/calc.ts',
      status: 'changed',
    };

    const patchModel = adaptDifftToViewModel({
      filePath: 'src/calc.ts',
      original,
      modified,
      difft,
      contextLines: 2,
      fullContext: false,
    });

    expect(patchModel.difftDecorations.language).toBe('TypeScript');
    expect(patchModel.difftDecorations.additionSpans.get(3)?.length).toBeGreaterThan(0);
    expect(patchModel.difftDecorations.deletionSpans.get(4)?.[0]?.content).toBe('oldName');
    expect(patchModel.fileDiff.hunks.length).toBe(2);

    // Verify @pierre/diffs DiffHunksRenderer renders both split and unified without error
    const splitRenderer = new DiffHunksRenderer({ diffStyle: 'split' });
    const unifiedRenderer = new DiffHunksRenderer({ diffStyle: 'unified' });
    expect(() => splitRenderer.renderDiff(patchModel.fileDiff)).not.toThrow();
    expect(() => unifiedRenderer.renderDiff(patchModel.fileDiff)).not.toThrow();

    // Verify fullContext mode also renders cleanly when line counts differ due to wrapped lines
    const fullModel = adaptDifftToViewModel({
      filePath: 'src/calc.ts',
      original: 'const x =\n  1;\nconst y = 2;\n',
      modified: 'const x = 1;\nconst y = 3;\n',
      difft: {
        aligned_lines: [
          [0, 0],
          [1, null],
          [2, 1],
        ],
        chunks: [
          [
            {
              lhs: {
                line_number: 2,
                changes: [{ start: 10, end: 11, content: '2', highlight: 'normal' }],
              },
              rhs: {
                line_number: 1,
                changes: [{ start: 10, end: 11, content: '3', highlight: 'normal' }],
              },
            },
          ],
        ],
        language: 'TypeScript',
        path: 'src/calc.ts',
        status: 'changed',
      },
      fullContext: true,
    });

    expect(fullModel.fileDiff.hunks.length).toBe(1);
    expect(() => splitRenderer.renderDiff(fullModel.fileDiff)).not.toThrow();
    expect(() => unifiedRenderer.renderDiff(fullModel.fileDiff)).not.toThrow();
  });

  test('splits multi-hunk files into separate hunks even when aligned_lines is omitted by difft', () => {
    const original = [
      'line1',
      'const first = 1;',
      'line3',
      'line4',
      'line5',
      'line6',
      'line7',
      'line8',
      'line9',
      'line10',
      'const last = 1;',
      'line12',
      '',
    ].join('\n');

    const modified = [
      'line1',
      'const first = 2;',
      'line3',
      'line4',
      'line5',
      'line6',
      'line7',
      'line8',
      'line9',
      'line10',
      'const last = 2;',
      'line12',
      '',
    ].join('\n');

    const adapted = adaptDifftToViewModel({
      filePath: 'src/multi.ts',
      original,
      modified,
      difft: {
        language: 'TypeScript',
        path: 'src/multi.ts',
        status: 'changed',
        chunks: [
          [
            {
              lhs: { line_number: 1, changes: [{ start: 14, end: 15, content: '1', highlight: 'normal' }] },
              rhs: { line_number: 1, changes: [{ start: 14, end: 15, content: '2', highlight: 'normal' }] },
            },
          ],
          [
            {
              lhs: { line_number: 10, changes: [{ start: 13, end: 14, content: '1', highlight: 'normal' }] },
              rhs: { line_number: 10, changes: [{ start: 13, end: 14, content: '2', highlight: 'normal' }] },
            },
          ],
        ],
      },
      contextLines: 1,
      fullContext: false,
    });

    expect(adapted.fileDiff.hunks).toHaveLength(2);
    expect(adapted.fileDiff.hunks[0]?.additionStart).toBe(1);
    expect(adapted.fileDiff.hunks[0]?.additionCount).toBe(3);
    expect(adapted.fileDiff.hunks[1]?.additionStart).toBe(10);
    expect(adapted.fileDiff.hunks[1]?.additionCount).toBe(3);
    expect(adapted.fileDiff.hunks[1]?.collapsedBefore).toBe(6);
  });

  test('reports empty structural hunks and preserves fallback line diff when difft reports unchanged', () => {
    const adapted = adaptDifftToViewModel({
      filePath: 'src/fmt.ts',
      original: 'const a = 1;\n',
      modified: 'const a   =   1;\n',
      difft: {
        language: 'TypeScript',
        path: 'src/fmt.ts',
        status: 'unchanged',
      },
    });

    expect(adapted.fileDiff.hunks).toHaveLength(0);
    expect(adapted.fallbackFileDiff.hunks).toHaveLength(1);
  });
});

describe('changesTree & baseBranch helpers', () => {
  test('compacts single-child directory chains in buildDiffTreeRows', () => {
    const rows = buildDiffTreeRows(
      [{ path: 'packages/ui/src/DiffView.tsx' }, { path: 'packages/ui/src/Selectors.tsx' }],
      new Set(),
    );
    expect(rows[0]).toMatchObject({
      kind: 'directory',
      path: 'packages/ui/src',
      label: 'packages/ui/src',
    });
    expect(rows).toHaveLength(3);
  });

  test('resolves branch comparison base in priority order including pullRequest base', () => {
    const resolved = resolveBranchComparisonBase(
      {
        chosen: null,
        pullRequest: 'develop',
        createdFrom: 'main',
        defaultBranch: 'main',
      },
      {
        localBranches: ['main', 'develop', 'feat/difft'],
        remoteBranches: ['origin/main', 'origin/develop'],
        remoteNames: new Set(['origin']),
        primaryRemote: 'origin',
        headBranch: 'feat/difft',
      },
    );
    expect(resolved).toEqual({
      ref: 'origin/develop',
      source: 'pull-request',
    });
  });

  test('chooses first non-hidden nested repository and skips home directory discovery', () => {
    expect(
      chooseAutoNestedRepo('/workspace', ['/workspace/.cache/repo', '/workspace/packages/app']),
    ).toBe('/workspace/packages/app');
    expect(discoversNestedRepos('/home/user', '/home/user')).toBe(false);
    expect(discoversNestedRepos('/home/user/workspace', '/home/user')).toBe(true);
  });
});

describe('package manifest & service integration', () => {
  test('manifest satisfies @openchamber/sdk contract and built entrypoints exist on disk', async () => {
    const pkgPath = path.resolve(import.meta.dir, '../package.json');
    const raw = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    expect(raw.openchamber.apiVersion).toBe(OPENCHAMBER_SDK_API_VERSION);
    expect(raw.openchamber.contributes.panel.id).toBe('difftastic-changes');
    const panelEntry = path.resolve(import.meta.dir, '..', raw.openchamber.contributes.panel.entry);
    const panelBundle = path.resolve(import.meta.dir, '../panel/main.js');
    const serviceBundle = path.resolve(import.meta.dir, '..', raw.openchamber.contributes.service.entry);
    expect((await fs.stat(panelEntry)).isFile()).toBe(true);
    expect((await fs.stat(panelBundle)).isFile()).toBe(true);
    expect((await fs.stat(serviceBundle)).isFile()).toBe(true);
  });

  test('service endpoints return status, range-files, log, commit-files, and difft JSON', async () => {
    const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-difft-test-repo-'));
    const serviceEntry = path.resolve(import.meta.dir, '../service/main.js');
    const servicePort = 43900 + Math.floor(Math.random() * 1000);
    const serviceToken = 'test-secret-token';

    const child = spawn(process.execPath, [serviceEntry], {
      env: {
        ...process.env,
        OPENCHAMBER_SERVICE_PORT: String(servicePort),
        OPENCHAMBER_SERVICE_TOKEN: serviceToken,
      },
      stdio: 'ignore',
    });

    try {
      execFileSync('git', ['init', '-b', 'main', tempRepo]);
      execFileSync('git', ['-C', tempRepo, 'config', 'user.email', 'test@example.com']);
      execFileSync('git', ['-C', tempRepo, 'config', 'user.name', 'Test User']);
      await fs.writeFile(
        path.join(tempRepo, 'math.ts'),
        'export function add(a: number, b: number) {\n  return a + b;\n}\n',
      );
      execFileSync('git', ['-C', tempRepo, 'add', 'math.ts']);
      execFileSync('git', ['-C', tempRepo, 'commit', '-m', 'Initial commit']);

      execFileSync('git', ['-C', tempRepo, 'checkout', '-b', 'feat/three-args', 'main']);
      await fs.writeFile(
        path.join(tempRepo, 'math.ts'),
        'export function add(a: number, b: number, c = 0) {\n  return a + b + c;\n}\n',
      );

      const getJson = async (pathname: string, query: Record<string, string> = {}) => {
        const url = new URL(pathname, `http://127.0.0.1:${servicePort}`);
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${serviceToken}` },
        });
        return { status: res.status, body: await res.json() };
      };

      // Wait for /health
      let ready = false;
      for (let i = 0; i < 30; i += 1) {
        try {
          const health = await getJson('/health');
          if (health.status === 200) {
            ready = true;
            break;
          }
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      expect(ready).toBe(true);

      const statusRes = await getJson('/status', { directory: tempRepo });
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.isGitRepo).toBe(true);
      expect(statusRes.body.current).toBe('feat/three-args');
      expect(statusRes.body.files).toEqual([
        { path: 'math.ts', index: '', working_dir: 'M' },
      ]);

      const diffRes = await getJson('/file-diff', {
        directory: tempRepo,
        scope: 'working',
        path: 'math.ts',
      });
      expect(diffRes.status).toBe(200);
      expect(diffRes.body.difft?.status).toBe('changed');
      expect(diffRes.body.difft?.language).toBe('TypeScript');
      expect(diffRes.body.difft?.chunks?.length).toBeGreaterThan(0);

      const rangeRes = await getJson('/range-files', {
        directory: tempRepo,
        base: 'refs/heads/main',
        head: 'feat/three-args',
        includeWorkingTree: 'true',
      });
      expect(rangeRes.status).toBe(200);
      expect(rangeRes.body.files).toHaveLength(1);
      expect(rangeRes.body.files[0].path).toBe('math.ts');

      // Create a nested git repository inside tempRepo and verify /git-dirs and nested_repository detection
      const nestedRepo = path.join(tempRepo, 'subprojects/child-repo');
      await fs.mkdir(nestedRepo, { recursive: true });
      execFileSync('git', ['init', '-b', 'main', nestedRepo]);

      const gitDirsRes = await getJson('/git-dirs', { directory: tempRepo });
      expect(gitDirsRes.status).toBe(200);
      expect(gitDirsRes.body.repositories).toEqual([
        { path: nestedRepo, name: 'child-repo' },
      ]);

      const nestedDiffRes = await getJson('/file-diff', {
        directory: tempRepo,
        scope: 'working',
        path: 'subprojects/child-repo/',
      });
      expect(nestedDiffRes.status).toBe(200);
      expect(nestedDiffRes.body.unavailableReason).toBe('nested_repository');
    } finally {
      child.kill('SIGTERM');
      await fs.rm(tempRepo, { recursive: true, force: true });
    }
  });
});
