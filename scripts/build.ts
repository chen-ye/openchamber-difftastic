#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type BunBuildLog = { message?: string };
type BunBuildOutput = { size: number; text: () => Promise<string> };
type BunBuildResult = {
  success: boolean;
  logs: BunBuildLog[];
  outputs: BunBuildOutput[];
};
type BunPluginBuilder = {
  onResolve: (
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string; namespace: string },
  ) => void;
  onLoad: (
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: 'js' },
  ) => void;
};
type BunPluginLike = {
  name: string;
  setup: (build: BunPluginBuilder) => void;
};

const bunRuntime = (
  globalThis as typeof globalThis & {
    Bun?: {
      build: (config: {
        entrypoints: string[];
        format: 'iife' | 'esm';
        target: 'browser' | 'node';
        minify: boolean;
        write: boolean;
        plugins?: BunPluginLike[];
      }) => Promise<BunBuildResult>;
    };
  }
).Bun;

if (!bunRuntime?.build) {
  console.error('This build script requires Bun.');
  process.exit(1);
}

// @pierre/diffs uses @pierre/highlights (embedded 180KB WASM lexer) and our
// host-registered theme (registerCustomTheme). Stubbing the unused Shiki
// grammar/theme catalogs keeps the browser IIFE bundle compact.
const stubUnusedPierreCatalogs: BunPluginLike = {
  name: 'stub-unused-pierre-catalogs',
  setup(build) {
    build.onResolve(
      { filter: /^(shiki(\/.*)?|@pierre\/highlights\/themes\/loader|@pierre\/theming\/themes)$/ },
      (args) => ({
        path: args.path,
        namespace: 'pierre-stub',
      }),
    );

    build.onLoad({ filter: /.*/, namespace: 'pierre-stub' }, () => ({
      contents: `
        export const createCssVariablesTheme = () => ({ name: 'stub', settings: [] });
        export const createHighlighterCore = async () => ({
          setTheme() {},
          codeToTokens(code) {
            return {
              tokens: String(code).split('\\n').map((line) => [{ content: line, offset: 0 }]),
            };
          },
          getLoadedLanguages: () => ['text', 'ansi'],
          loadLanguageSync() {},
          getLanguage: () => ({}),
          dispose() {},
        });
        export const createOnigurumaEngine = async () => ({});
        export const createJavaScriptRegexEngine = () => ({});
        export const EncodedTokenMetadata = {};
        export const INITIAL = {};
        export const bundledLanguages = {};
        export const bundledThemes = {};
        export default {};
      `,
      loader: 'js',
    }));
  },
};

const buildPanel = async () => {
  const entry = resolve(root, 'panel/main.tsx');
  const outfile = resolve(root, 'panel/main.js');
  const result = await bunRuntime.build({
    entrypoints: [entry],
    format: 'iife',
    target: 'browser',
    minify: true,
    write: false,
    plugins: [stubUnusedPierreCatalogs],
  });

  if (!result.success) {
    const message = result.logs.map((log) => log.message).join('\n');
    console.error(message || 'Panel build failed');
    process.exit(1);
  }

  const artifact = result.outputs[0];
  if (!artifact) {
    console.error('Panel build produced no output');
    process.exit(1);
  }

  await writeFile(outfile, await artifact.text());
  console.log(`Built panel/main.js (${(artifact.size / 1024).toFixed(1)} KB)`);
};

const buildService = async () => {
  const entry = resolve(root, 'service/main.ts');
  const outfile = resolve(root, 'service/main.js');
  const result = await bunRuntime.build({
    entrypoints: [entry],
    format: 'esm',
    target: 'node',
    minify: false,
    write: false,
  });

  if (!result.success) {
    const message = result.logs.map((log) => log.message).join('\n');
    console.error(message || 'Service build failed');
    process.exit(1);
  }

  const artifact = result.outputs[0];
  if (!artifact) {
    console.error('Service build produced no output');
    process.exit(1);
  }

  await writeFile(outfile, await artifact.text());
  console.log(`Built service/main.js (${(artifact.size / 1024).toFixed(1)} KB)`);
};

await Promise.all([buildPanel(), buildService()]);
