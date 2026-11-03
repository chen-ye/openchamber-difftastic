import {
  canUseWASM,
  EXTENSION_TO_FILE_FORMAT,
  registerCustomTheme,
  setCustomExtension,
  type DiffsTheme,
  type HighlighterTypes,
} from '@pierre/diffs';
import type { Theme as ZedTheme, ThemeSyntaxSettings } from '@pierre/highlights';
import type { HostReadyContext } from '@openchamber/sdk';

export const DIFFS_HIGHLIGHTER: HighlighterTypes = canUseWASM() ? 'highlights' : 'shiki-js';

const LANGUAGE_ALIASES = new Map(
  Object.entries({
    blade: 'html',
    crystal: 'ruby',
    desktop: 'toml',
    dotenv: 'bash',
    edge: 'html',
    erb: 'html',
    'glimmer-js': 'javascript',
    'glimmer-ts': 'typescript',
    handlebars: 'html',
    hjson: 'json5',
    ini: 'toml',
    jinja: 'html',
    liquid: 'html',
    luau: 'lua',
    mdc: 'markdown',
    mojo: 'python',
    postcss: 'css',
    properties: 'toml',
    razor: 'html',
    systemd: 'toml',
    twig: 'html',
    'vue-vine': 'typescript',
    xsl: 'xml',
  }),
);

const FILE_NAME_LANGUAGES = {
  '.editorconfig': 'toml',
  '.gitmodules': 'toml',
  '.npmrc': 'toml',
};

if (DIFFS_HIGHLIGHTER === 'highlights') {
  for (const [extension, lang] of Object.entries(EXTENSION_TO_FILE_FORMAT)) {
    const alias = lang && LANGUAGE_ALIASES.get(lang);
    if (alias) setCustomExtension(extension, alias);
  }
  for (const [name, lang] of Object.entries(FILE_NAME_LANGUAGES)) {
    setCustomExtension(name, lang);
  }
}

let colorProbe: CanvasRenderingContext2D | null | undefined;

const toHexColor = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (typeof document !== 'undefined' && 'CSS' in globalThis && CSS.supports('color', trimmed)) {
    colorProbe ??= document.createElement('canvas').getContext('2d');
    if (colorProbe) {
      colorProbe.fillStyle = trimmed;
      const resolved = colorProbe.fillStyle;
      if (/^#[0-9a-fA-F]{6}$/.test(resolved)) return resolved;
    }
  }
  return fallback;
};

const registeredSignatures = new Map<string, string>();

export const ensureHostPierreThemeRegistered = (theme: HostReadyContext['theme']): string => {
  const mode = theme.mode;
  const t = theme.tokens;
  const isDark = mode === 'dark';

  const bg = toHexColor(t.background, isDark ? '#141416' : '#ffffff');
  const fg = toHexColor(t.foreground, isDark ? '#e6e6e8' : '#18181b');
  const muted = toHexColor(t.muted, isDark ? '#8b8d94' : '#71717a');
  const keyword = toHexColor(t.syntaxKeyword ?? t.primary, isDark ? '#c084fc' : '#7c3aed');
  const string = toHexColor(t.syntaxString ?? t.success, isDark ? '#86efac' : '#16a34a');
  const number = toHexColor(t.syntaxNumber ?? t.warning, isDark ? '#fdba74' : '#d97706');
  const func = toHexColor(t.syntaxFunction ?? t.info, isDark ? '#93c5fd' : '#2563eb');
  const type = toHexColor(t.syntaxType ?? t.info, isDark ? '#67e8f9' : '#0284c7');
  const comment = toHexColor(t.syntaxComment ?? muted, muted);
  const variable = toHexColor(t.syntaxVariable ?? fg, fg);
  const operator = toHexColor(t.syntaxOperator ?? muted, muted);
  const success = toHexColor(t.success, isDark ? '#4ade80' : '#16a34a');
  const error = toHexColor(t.error, isDark ? '#f87171' : '#dc2626');
  const info = toHexColor(t.info, isDark ? '#60a5fa' : '#2563eb');

  const signature = [
    mode,
    bg,
    fg,
    muted,
    keyword,
    string,
    number,
    func,
    type,
    comment,
    variable,
    operator,
    success,
    error,
    info,
  ].join('|');

  const themeId = `oc-host-${mode}-${fnv1a(signature)}`;
  if (registeredSignatures.get(themeId) === signature) {
    return themeId;
  }

  const rule = (color: string, opts?: { bold?: boolean; italic?: boolean }): ThemeSyntaxSettings => {
    const s: ThemeSyntaxSettings = { color };
    if (opts?.bold) s.font_weight = 700;
    if (opts?.italic) s.font_style = 'italic';
    return s;
  };

  const zed: ZedTheme = {
    name: themeId,
    appearance: mode,
    style: {
      'editor.background': bg,
      'editor.foreground': fg,
      syntax: {
        attribute: rule(type),
        boolean: rule(number),
        comment: rule(comment, { italic: true }),
        'comment.doc': rule(comment, { italic: true }),
        constant: rule(number),
        'constant.builtin': rule(number),
        constructor: rule(type),
        'diff.minus': rule(error),
        'diff.plus': rule(success),
        embedded: rule(fg),
        emphasis: { font_style: 'italic' },
        'emphasis.strong': { font_weight: 700 },
        enum: rule(type),
        function: rule(func, { bold: true }),
        'function.method': rule(func, { bold: true }),
        hint: rule(comment),
        keyword: rule(keyword),
        'keyword.control': rule(keyword),
        'keyword.declaration': rule(keyword),
        'keyword.import': rule(keyword),
        'keyword.jsdoc': rule(type),
        'keyword.operator': rule(operator),
        label: rule(type),
        link_text: rule(string),
        link_uri: rule(info),
        namespace: rule(type),
        number: rule(number),
        operator: rule(operator),
        predictive: rule(comment),
        preproc: rule(keyword),
        primary: rule(fg),
        property: rule(variable),
        'property.json_key': rule(type),
        punctuation: rule(operator),
        'punctuation.bracket': rule(operator),
        'punctuation.delimiter': rule(operator),
        'punctuation.list_marker': rule(type),
        'punctuation.special': rule(keyword),
        selector: rule(keyword),
        'selector.class': rule(type),
        'selector.id': rule(func),
        'selector.pseudo': rule(operator),
        string: rule(string),
        'string.escape': rule(number),
        'string.regex': rule(string),
        'string.special': rule(number),
        'string.special.symbol': rule(number),
        tag: rule(keyword),
        'tag.component.jsx': rule(type),
        'tag.doctype': rule(keyword),
        'text.jsx': rule(fg),
        'text.literal': rule(string),
        title: rule(keyword, { bold: true }),
        type: rule(type),
        'type.builtin': rule(type),
        'type.class': rule(type),
        'type.jsdoc': rule(type),
        variable: rule(variable),
        'variable.jsdoc': rule(variable),
        'variable.parameter': rule(variable),
        'variable.special': rule(keyword),
        variant: rule(number),
      },
    },
  };

  const colors: Record<string, string> = {
    'editor.background': bg,
    'editor.foreground': fg,
    'terminal.ansiGreen': success,
    'terminal.ansiRed': error,
    'terminal.ansiBlue': info,
    'gitDecoration.addedResourceForeground': success,
    'gitDecoration.deletedResourceForeground': error,
    'gitDecoration.modifiedResourceForeground': info,
  };

  const diffsTheme: DiffsTheme = {
    name: themeId,
    type: mode,
    fg,
    bg,
    colors,
    textmate: {
      name: themeId,
      type: mode,
      fg,
      bg,
      colors,
      settings: [],
      tokenColors: [],
    },
    zed,
  };

  registerCustomTheme(themeId, async () => diffsTheme, 'diffs');
  registeredSignatures.set(themeId, signature);
  return themeId;
};

const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
};
