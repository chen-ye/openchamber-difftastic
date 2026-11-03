// service/main.ts
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync, accessSync, statSync, constants as fsConstants } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!port || !token) {
  console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "bmp",
  "avif"
]);
var IMAGE_MIMES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif"
};
var BINARY_SNIFF_BYTES = 8192;
var UNTRACKED_DIR_EXPANSION_LIMIT = 500;
var GIT_DIRS_MAX_DEPTH = 3;
var GIT_DIRS_MAX_DIRS = 100;
var GIT_DIRS_SKIP_LIST = new Set([
  "node_modules",
  "dist",
  "build",
  ".venv",
  "target",
  ".next"
]);
var GITLINK_MODE = "160000";
var SHA_RE = /^[0-9a-f]{7,64}$/i;
var isExecutable = (filePath) => {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile())
      return false;
    if (process.platform === "win32")
      return true;
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};
var resolveBinaryOnSystem = (binName) => {
  const isWin = process.platform === "win32";
  const exeName = isWin && !binName.endsWith(".exe") ? `${binName}.exe` : binName;
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  const user = process.env.USER || process.env.USERNAME || "";
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const candidates = [
    ...pathDirs.map((dir) => path.join(dir, exeName)),
    ...isWin ? [
      path.join(home, "scoop", "shims", exeName),
      path.join(localAppData, "Microsoft", "WinGet", "Links", exeName),
      path.join(home, ".cargo", "bin", exeName)
    ] : [
      path.join(home, ".local", "bin", exeName),
      path.join(home, ".cargo", "bin", exeName),
      path.join(home, ".nix-profile", "bin", exeName),
      ...user ? [`/etc/profiles/per-user/${user}/bin/${exeName}`] : [],
      `/run/current-system/sw/bin/${exeName}`,
      `/opt/homebrew/bin/${exeName}`,
      `/home/linuxbrew/.linuxbrew/bin/${exeName}`,
      `/usr/local/bin/${exeName}`,
      `/usr/bin/${exeName}`
    ]
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
};
var cachedDifftBin = null;
var cachedDifftVersion = null;
var cachedGhBin = null;
var getDifftInfo = async () => {
  if (!cachedDifftBin || !isExecutable(cachedDifftBin)) {
    cachedDifftBin = resolveBinaryOnSystem("difft");
    cachedDifftVersion = null;
    if (cachedDifftBin) {
      cachedDifftVersion = await new Promise((resolve) => {
        execFile(cachedDifftBin, ["--version"], { timeout: 3000 }, (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          resolve(stdout.split(`
`)[0]?.trim() || null);
        });
      });
    }
  }
  return { bin: cachedDifftBin, version: cachedDifftVersion };
};
var getGhBinary = () => {
  if (!cachedGhBin || !isExecutable(cachedGhBin)) {
    cachedGhBin = resolveBinaryOnSystem("gh");
  }
  return cachedGhBin;
};
var git = (cwd, args, extraEnv) => new Promise((resolve) => {
  execFile("git", ["-C", cwd, ...args], {
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      ...extraEnv
    }
  }, (error, stdout, stderr) => {
    if (!error) {
      resolve({ ok: true, stdout, stderr });
      return;
    }
    resolve({
      ok: false,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      code: "code" in error ? error.code : undefined
    });
  });
});
var gitBuffer = (cwd, args) => new Promise((resolve) => {
  execFile("git", ["-C", cwd, ...args], {
    timeout: 15000,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "buffer",
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0"
    }
  }, (error, stdout) => {
    if (error || !Buffer.isBuffer(stdout)) {
      resolve(null);
      return;
    }
    resolve(stdout);
  });
});
var execGh = (cwd, args) => {
  const bin = getGhBinary();
  if (!bin) {
    return Promise.resolve({ ok: false, stdout: "", stderr: "gh binary not found" });
  }
  return new Promise((resolve) => {
    execFile(bin, args, {
      cwd,
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1"
      }
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ ok: true, stdout, stderr });
        return;
      }
      resolve({
        ok: false,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: "code" in error ? error.code : undefined
      });
    });
  });
};
var execGhBuffer = (cwd, args) => {
  const bin = getGhBinary();
  if (!bin)
    return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(bin, args, {
      cwd,
      timeout: 15000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "buffer",
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1"
      }
    }, (error, stdout) => {
      if (error || !Buffer.isBuffer(stdout)) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });
  });
};
var isImagePath = (filePath) => {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};
var getImageMime = (filePath) => {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_MIMES[ext] ?? "application/octet-stream";
};
var bufferLooksBinary = (buf) => {
  const slice = buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES));
  return slice.includes(0);
};
var isSafeRepoRelativePath = (repoRoot, relPath) => {
  if (!relPath || relPath.includes("\x00") || path.isAbsolute(relPath))
    return false;
  const resolved = path.resolve(repoRoot, relPath);
  const rel = path.relative(repoRoot, resolved);
  return Boolean(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
};
var isSafeGitRef = (ref) => {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.includes(".."))
    return false;
  if (/[\0-\x20\x7f~^:?*[\\]/.test(trimmed))
    return false;
  return true;
};
var isRealpathInsideRepo = async (repoRoot, targetPath) => {
  try {
    const [canonicalRoot, canonicalTarget] = await Promise.all([
      fs.realpath(repoRoot),
      fs.realpath(targetPath)
    ]);
    const rel = path.relative(canonicalRoot, canonicalTarget);
    return Boolean(rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
};
var readWorkingTreeBuffer = async (repoRoot, absPath) => {
  try {
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = await fs.readlink(absPath);
      return Buffer.from(linkTarget, "utf8");
    }
    if (!stat.isFile())
      return null;
    if (!await isRealpathInsideRepo(repoRoot, absPath))
      return null;
    return await fs.readFile(absPath);
  } catch {
    return null;
  }
};
var findGitDirectories = async (rootPath) => {
  const homeDirectory = os.homedir();
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  const normalizedHome = homeDirectory.replace(/[\\/]+$/, "");
  if (normalizedRoot === normalizedHome) {
    return { path: rootPath, homeDirectory, repositories: [] };
  }
  const results = [];
  const walkedRealPaths = new Set;
  const queue = [{ dir: rootPath, depth: 0 }];
  let visited = 0;
  const scanDirectory = async (dir, depth) => {
    let realPath;
    try {
      realPath = await fs.realpath(dir);
    } catch (error) {
      if (dir === rootPath)
        throw error;
      return;
    }
    if (walkedRealPaths.has(realPath))
      return;
    walkedRealPaths.add(realPath);
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (dir === rootPath)
        throw error;
      return;
    }
    visited += 1;
    let isRepoBoundary = false;
    const subdirectories = [];
    for (const dirent of dirents) {
      if (dirent.name === ".git") {
        isRepoBoundary = true;
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isSymbolicLink())
        continue;
      if (GIT_DIRS_SKIP_LIST.has(dirent.name))
        continue;
      if (depth >= GIT_DIRS_MAX_DEPTH)
        continue;
      if (dirent.isSymbolicLink()) {
        const target = await fs.stat(path.join(dir, dirent.name)).catch(() => null);
        if (!target?.isDirectory())
          continue;
      }
      subdirectories.push(dirent.name);
    }
    if (isRepoBoundary && dir !== rootPath) {
      results.push(dir);
      return;
    }
    subdirectories.sort();
    for (const name of subdirectories) {
      queue.push({ dir: path.join(dir, name), depth: depth + 1 });
    }
  };
  for (let index = 0;index < queue.length && visited < GIT_DIRS_MAX_DIRS; index += 1) {
    const item = queue[index];
    if (!item)
      break;
    await scanDirectory(item.dir, item.depth);
  }
  return {
    path: rootPath,
    homeDirectory,
    repositories: results.map((repoPath) => ({
      path: repoPath,
      name: path.basename(repoPath)
    }))
  };
};
var readGitEntryInfo = async (repoRoot, args, repoPath) => {
  const res = await git(repoRoot, args);
  if (!res.ok)
    return null;
  for (const record of res.stdout.split("\x00")) {
    const tab = record.indexOf("\t");
    if (tab !== -1 && record.slice(tab + 1) === repoPath) {
      const meta = record.slice(0, tab).trim().split(/\s+/);
      const mode = meta[0] ?? "";
      const hash = meta.length >= 3 && (meta[1] === "blob" || meta[1] === "commit" || meta[1] === "tree") ? meta[2] ?? "" : meta[1] ?? "";
      return { mode, hash };
    }
  }
  return null;
};
var readGitEntryMode = async (repoRoot, args, repoPath) => {
  const info = await readGitEntryInfo(repoRoot, args, repoPath);
  return info?.mode ?? null;
};
var readSubmoduleState = async (repoRoot, repoPath, absPath) => {
  const status = await git(repoRoot, [
    "status",
    "--porcelain=v2",
    "-z",
    "--",
    `:(literal)${repoPath}`
  ]);
  const record = status.ok ? status.stdout.split("\x00").find((entry) => /^[12u] /.test(entry))?.split(" ") : undefined;
  const hasConflict = record?.[0] === "u";
  const readHead = async () => {
    const r = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `HEAD:${repoPath}`]);
    return r.ok ? r.stdout.trim() : "";
  };
  const head = record && !hasConflict ? record[6] ?? "" : await readHead();
  const index = hasConflict ? "" : record ? record[7] ?? "" : head;
  const flags = record ? record[2] ?? "S..." : "S...";
  const initialized = await fs.lstat(path.join(absPath, ".git")).then(() => true).catch(() => false);
  const worktree = initialized ? await git(absPath, ["rev-parse", "--verify", "HEAD"]) : null;
  const commitOrNull = (val) => val && !/^0+$/.test(val) ? val : null;
  return {
    headCommit: commitOrNull(head),
    indexCommit: commitOrNull(index),
    worktreeCommit: worktree?.ok ? worktree.stdout.trim() : null,
    hasTrackedChanges: flags[2] === "M",
    hasUntrackedFiles: flags[3] === "U",
    hasConflict
  };
};
var parseNumstatZ = (raw) => {
  const stats = {};
  const tokens = raw.split("\x00");
  for (let i = 0;i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token)
      continue;
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(token);
    if (!match)
      continue;
    let filePath = match[3] ?? "";
    if (!filePath) {
      filePath = tokens[i + 2] ?? "";
      i += 2;
    }
    if (filePath) {
      stats[filePath] = {
        insertions: Number.parseInt(match[1] ?? "0", 10) || 0,
        deletions: Number.parseInt(match[2] ?? "0", 10) || 0
      };
    }
  }
  return stats;
};
var parseBranchCreationSource = (reflogText) => {
  const lines = reflogText.split(`
`).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => /^rebase(?:\s|\()/.test(line)))
    return null;
  for (let i = lines.length - 1;i >= 0; i -= 1) {
    const match = /^branch: Created from (.+)$/.exec(lines[i] ?? "");
    if (!match)
      continue;
    const source = (match[1] ?? "").trim();
    if (!source || /^HEAD(@|$)/.test(source) || /^[0-9a-f]{7,40}$/i.test(source)) {
      return null;
    }
    return source;
  }
  return null;
};
var detectCreatedFromBase = async (repoRoot, branchName, remotes) => {
  if (!branchName || branchName === "HEAD")
    return null;
  const ghMergeBase = await git(repoRoot, ["config", "--get", `branch.${branchName}.gh-merge-base`]);
  const recorded = ghMergeBase.ok ? ghMergeBase.stdout.trim() : "";
  if (recorded && recorded !== branchName && isSafeGitRef(recorded)) {
    for (const ref of [
      `refs/heads/${recorded}`,
      ...remotes.map((r) => `refs/remotes/${r}/${recorded}`)
    ]) {
      const check = await git(repoRoot, ["rev-parse", "--verify", "--quiet", ref]);
      if (check.ok && check.stdout.trim())
        return recorded;
    }
  }
  const reflog = await git(repoRoot, ["reflog", "show", "--format=%gs", branchName]);
  if (!reflog.ok)
    return null;
  const source = parseBranchCreationSource(reflog.stdout);
  if (!source || source === branchName || !isSafeGitRef(source))
    return null;
  const check = await git(repoRoot, ["rev-parse", "--verify", "--quiet", source]);
  if (!check.ok || !check.stdout.trim())
    return null;
  const fullNameRes = await git(repoRoot, ["rev-parse", "--symbolic-full-name", source]);
  const fullName = fullNameRes.ok ? fullNameRes.stdout.trim() : "";
  if (fullName.startsWith("refs/remotes/")) {
    const withoutRemote = fullName.slice("refs/remotes/".length).split("/").slice(1).join("/");
    if (withoutRemote === branchName)
      return null;
  }
  return source;
};
var readStatus = async (directory) => {
  const difftInfo = await getDifftInfo();
  const homeDirectory = os.homedir();
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim()) {
    return {
      isGitRepo: false,
      repoRoot: null,
      homeDirectory,
      current: null,
      files: [],
      diffStats: { staged: {}, working: {} },
      branches: { all: [], defaultBranches: {}, remotes: [], primaryRemote: null },
      createdFromBase: null,
      difftAvailable: Boolean(difftInfo.bin),
      difftVersion: difftInfo.version
    };
  }
  const repoRoot = top.stdout.trim();
  const [
    branchRes,
    headVerifyRes,
    porcelainRes,
    stagedNumstatRes,
    workingNumstatRes,
    refsRes,
    remotesRes
  ] = await Promise.all([
    git(repoRoot, ["symbolic-ref", "--short", "-q", "HEAD"]),
    git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]),
    git(repoRoot, ["status", "--porcelain=v1", "-z", "-unormal"]),
    git(repoRoot, ["diff", "--cached", "-M", "--numstat", "-z"]),
    git(repoRoot, ["diff-files", "-M", "--numstat", "-z"]),
    git(repoRoot, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]),
    git(repoRoot, ["remote"])
  ]);
  if (!porcelainRes.ok) {
    throw new Error(porcelainRes.stderr.trim() || "git status failed");
  }
  const unborn = !headVerifyRes.ok || !headVerifyRes.stdout.trim();
  const current = branchRes.ok ? branchRes.stdout.trim() || "HEAD" : "HEAD";
  const stagedStats = stagedNumstatRes.ok ? parseNumstatZ(stagedNumstatRes.stdout) : {};
  const workingStats = workingNumstatRes.ok ? parseNumstatZ(workingNumstatRes.stdout) : {};
  const files = [];
  const tokens = porcelainRes.stdout.split("\x00");
  for (let i = 0;i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (!entry || entry.length < 4)
      continue;
    const indexChar = entry[0] ?? " ";
    const workingChar = entry[1] ?? " ";
    const filePath = entry.slice(3);
    const isRenameOrCopy = indexChar === "R" || indexChar === "C" || workingChar === "R" || workingChar === "C";
    const previousPath = isRenameOrCopy ? tokens[++i] : undefined;
    if (!filePath)
      continue;
    if (indexChar === "?" && workingChar === "?" && filePath.endsWith("/")) {
      const absDir = path.join(repoRoot, filePath);
      const hasDotGit = await fs.lstat(path.join(absDir, ".git")).then(() => true).catch(() => false);
      if (!hasDotGit) {
        const expanded = await git(repoRoot, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          filePath
        ]);
        const subPaths = expanded.ok ? expanded.stdout.split("\x00").filter(Boolean) : [];
        if (subPaths.length > 0 && subPaths.length <= UNTRACKED_DIR_EXPANSION_LIMIT) {
          for (const sub of subPaths) {
            files.push({ path: sub, index: "?", working_dir: "?" });
          }
          continue;
        }
      }
    }
    const item = {
      path: filePath,
      index: indexChar === " " ? "" : indexChar,
      working_dir: workingChar === " " ? "" : workingChar
    };
    if (previousPath)
      item.previousPath = previousPath;
    files.push(item);
  }
  const untrackedFiles = files.filter((f) => f.index === "?" && !f.path.endsWith("/")).slice(0, 150);
  await Promise.all(untrackedFiles.map(async (f) => {
    if (workingStats[f.path])
      return;
    try {
      const abs = path.join(repoRoot, f.path);
      const stat = await fs.lstat(abs);
      if (stat.isSymbolicLink()) {
        workingStats[f.path] = { insertions: 1, deletions: 0 };
        return;
      }
      if (!stat.isFile() || stat.size > 512 * 1024)
        return;
      const buf = await readWorkingTreeBuffer(repoRoot, abs);
      if (!buf || bufferLooksBinary(buf))
        return;
      const text = buf.toString("utf8");
      const lines = text.length === 0 ? 0 : text.replace(/\r?\n$/, "").split(/\r?\n/).length;
      workingStats[f.path] = { insertions: lines, deletions: 0 };
    } catch {}
  }));
  const remotes = remotesRes.ok ? remotesRes.stdout.split(`
`).map((r) => r.trim()).filter(Boolean) : [];
  const primaryRemote = remotes.includes("origin") ? "origin" : remotes[0] ?? null;
  const allBranches = [];
  if (refsRes.ok) {
    for (const rawLine of refsRes.stdout.split(`
`)) {
      const ref = rawLine.trim();
      if (ref.startsWith("refs/heads/")) {
        allBranches.push(ref.slice("refs/heads/".length));
      } else if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD")) {
        allBranches.push(`remotes/${ref.slice("refs/remotes/".length)}`);
      }
    }
  }
  const defaultBranches = {};
  for (const remote of remotes) {
    const sym = await git(repoRoot, ["symbolic-ref", "-q", `refs/remotes/${remote}/HEAD`]);
    const prefix = `refs/remotes/${remote}/`;
    if (sym.ok && sym.stdout.trim().startsWith(prefix)) {
      defaultBranches[remote] = sym.stdout.trim().slice(prefix.length);
    } else if (allBranches.includes(`remotes/${remote}/main`) || allBranches.includes("main")) {
      defaultBranches[remote] = "main";
    } else if (allBranches.includes(`remotes/${remote}/master`) || allBranches.includes("master")) {
      defaultBranches[remote] = "master";
    }
  }
  const createdFromBase = await detectCreatedFromBase(repoRoot, current, remotes);
  return {
    isGitRepo: true,
    unborn,
    repoRoot,
    homeDirectory,
    current,
    files,
    diffStats: {
      staged: stagedStats,
      working: workingStats
    },
    branches: {
      all: allBranches,
      defaultBranches,
      remotes,
      primaryRemote
    },
    createdFromBase,
    difftAvailable: Boolean(difftInfo.bin),
    difftVersion: difftInfo.version
  };
};
var readFileSignature = async (absPath) => {
  try {
    const stat = await fs.lstat(absPath, { bigint: true });
    return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch {
    return "missing";
  }
};
var readRangeFiles = async (directory, baseRef, headRef, includeWorkingTree) => {
  if (!isSafeGitRef(baseRef) || !isSafeGitRef(headRef)) {
    throw new Error("Invalid branch reference");
  }
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim())
    throw new Error("Not a git repository");
  const repoRoot = top.stdout.trim();
  const [mergeBaseRes, headCommitRes] = await Promise.all([
    git(repoRoot, ["merge-base", baseRef, headRef]),
    git(repoRoot, ["rev-parse", "--verify", "--quiet", headRef])
  ]);
  if (!mergeBaseRes.ok || !mergeBaseRes.stdout.trim()) {
    throw new Error(`Could not resolve merge-base between ${baseRef} and ${headRef}`);
  }
  const mergeBase = mergeBaseRes.stdout.trim();
  const headSha = headCommitRes.ok ? headCommitRes.stdout.trim() : headRef;
  let nameStatusRaw = "";
  let numstatRaw = "";
  if (includeWorkingTree) {
    const untrackedRes = await git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const rawUntrackedPaths = untrackedRes.ok ? untrackedRes.stdout.split("\x00").filter(Boolean) : [];
    const filteredUntracked = [];
    for (const rel of rawUntrackedPaths) {
      const abs = path.join(repoRoot, rel);
      const hasDotGit = await fs.lstat(path.join(abs, ".git")).then(() => true).catch(() => false);
      if (!hasDotGit) {
        filteredUntracked.push(rel);
      }
    }
    const untracked = filteredUntracked.length > 0 ? `${filteredUntracked.join("\x00")}\x00` : "";
    if (untracked) {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-difft-idx-"));
      try {
        const indexPathRes = await git(repoRoot, ["rev-parse", "--git-path", "index"]);
        const indexPath = path.resolve(repoRoot, indexPathRes.ok ? indexPathRes.stdout.trim() : ".git/index");
        const tempIndex = path.join(tempDir, "index");
        if (existsSync(indexPath)) {
          await fs.copyFile(indexPath, tempIndex);
        }
        const pathspecFile = path.join(tempDir, "paths");
        await fs.writeFile(pathspecFile, untracked);
        const extraEnv = { GIT_INDEX_FILE: tempIndex, GIT_LITERAL_PATHSPECS: "1" };
        await git(repoRoot, ["add", "--intent-to-add", `--pathspec-from-file=${pathspecFile}`, "--pathspec-file-nul"], extraEnv);
        const [ns, num] = await Promise.all([
          git(repoRoot, ["diff", "--name-status", "-z", "-C", mergeBase, "--"], extraEnv),
          git(repoRoot, ["diff", "--numstat", "-z", "-C", mergeBase, "--"], extraEnv)
        ]);
        if (!ns.ok || !num.ok) {
          throw new Error(ns.stderr.trim() || num.stderr.trim() || "git range diff failed");
        }
        nameStatusRaw = ns.stdout;
        numstatRaw = num.stdout;
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } else {
      const [ns, num] = await Promise.all([
        git(repoRoot, ["diff", "--name-status", "-z", "-C", mergeBase, "--"]),
        git(repoRoot, ["diff", "--numstat", "-z", "-C", mergeBase, "--"])
      ]);
      if (!ns.ok || !num.ok) {
        throw new Error(ns.stderr.trim() || num.stderr.trim() || "git range diff failed");
      }
      nameStatusRaw = ns.stdout;
      numstatRaw = num.stdout;
    }
  } else {
    const [ns, num] = await Promise.all([
      git(repoRoot, ["diff", "--name-status", "-z", "-C", `${baseRef}...${headRef}`, "--"]),
      git(repoRoot, ["diff", "--numstat", "-z", "-C", `${baseRef}...${headRef}`, "--"])
    ]);
    if (!ns.ok || !num.ok) {
      throw new Error(ns.stderr.trim() || num.stderr.trim() || "git range diff failed");
    }
    nameStatusRaw = ns.stdout;
    numstatRaw = num.stdout;
  }
  const statsMap = parseNumstatZ(numstatRaw);
  const tokens = nameStatusRaw.split("\x00");
  const rawFiles = [];
  for (let i = 0;i < tokens.length; i += 1) {
    const status = (tokens[i] ?? "").trim();
    if (!status)
      continue;
    const isRenameOrCopy = status.startsWith("R") || status.startsWith("C");
    const previousPath = isRenameOrCopy ? tokens[i + 1] : undefined;
    const filePath = isRenameOrCopy ? tokens[i + 2] ?? "" : tokens[i + 1] ?? "";
    i += isRenameOrCopy ? 2 : 1;
    if (filePath) {
      rawFiles.push({
        path: filePath,
        previousPath,
        status: status.charAt(0)
      });
    }
  }
  const files = await Promise.all(rawFiles.map(async (f) => {
    const st = statsMap[f.path];
    const sig = includeWorkingTree ? `${mergeBase}:${await readFileSignature(path.join(repoRoot, f.path))}` : `${mergeBase}:${headSha}`;
    return {
      ...f,
      insertions: st?.insertions ?? 0,
      deletions: st?.deletions ?? 0,
      revision: sig
    };
  }));
  return { files };
};
var readLog = async (directory, maxCount, toRef) => {
  if (!isSafeGitRef(toRef)) {
    throw new Error("Invalid log revision");
  }
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim())
    throw new Error("Not a git repository");
  const repoRoot = top.stdout.trim();
  const format = "%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f";
  const res = await git(repoRoot, [
    "log",
    `--max-count=${Math.min(Math.max(1, maxCount), 100)}`,
    `--pretty=format:${format}`,
    "--shortstat",
    toRef,
    "--"
  ]);
  if (!res.ok) {
    if (/does not have any commits yet|bad default revision 'HEAD'|unknown revision/i.test(res.stderr)) {
      return { all: [] };
    }
    throw new Error(res.stderr.trim() || "git log failed");
  }
  const all = [];
  for (const record of res.stdout.split("\x1E")) {
    const trimmed = record.trim();
    if (!trimmed)
      continue;
    const [
      hash = "",
      parents = "",
      author_name = "",
      author_email = "",
      date = "",
      message = "",
      stat = ""
    ] = trimmed.split("\x1F");
    if (!hash)
      continue;
    all.push({
      hash,
      parents: parents.split(" ").filter(Boolean),
      author_name,
      author_email,
      date,
      message,
      files: Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0),
      insertions: Number(/(\d+) insertions?\(\+\)/.exec(stat)?.[1] ?? 0),
      deletions: Number(/(\d+) deletions?\(-\)/.exec(stat)?.[1] ?? 0)
    });
  }
  return { all };
};
var readCommitFiles = async (directory, commitHash) => {
  if (!SHA_RE.test(commitHash))
    throw new Error("Invalid commit hash");
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim())
    throw new Error("Not a git repository");
  const repoRoot = top.stdout.trim();
  const baseArgs = [
    "show",
    "--format=",
    "--root",
    "--diff-merges=first-parent",
    "--find-renames",
    commitHash
  ];
  const [numstatRes, nameStatusRes] = await Promise.all([
    git(repoRoot, [...baseArgs, "--numstat", "-z", "--"]),
    git(repoRoot, [...baseArgs, "--name-status", "-z", "--"])
  ]);
  if (!numstatRes.ok || !nameStatusRes.ok) {
    throw new Error("Failed to read commit files");
  }
  const stats = new Map;
  const numTokens = numstatRes.stdout.split("\x00");
  for (let i = 0;i < numTokens.length; i += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(numTokens[i] ?? "");
    if (!match)
      continue;
    let dest = match[3] ?? "";
    if (!dest) {
      dest = numTokens[i + 2] ?? "";
      i += 2;
    }
    stats.set(dest, {
      insertions: Number.parseInt(match[1] ?? "0", 10) || 0,
      deletions: Number.parseInt(match[2] ?? "0", 10) || 0,
      isBinary: match[1] === "-"
    });
  }
  const files = [];
  const names = nameStatusRes.stdout.split("\x00");
  for (let i = 0;i < names.length; i += 1) {
    const status = (names[i] ?? "").charAt(0);
    if (!status)
      continue;
    const renamed = status === "R" || status === "C";
    const previousPath = renamed ? names[++i] : undefined;
    const filePath = names[++i] ?? "";
    if (!filePath)
      continue;
    const st = stats.get(filePath) ?? { insertions: 0, deletions: 0, isBinary: false };
    files.push({
      path: filePath,
      previousPath,
      status,
      ...st
    });
  }
  return { files };
};
var readPullRequests = async (directory) => {
  const bin = getGhBinary();
  if (!bin) {
    return {
      available: false,
      prs: [],
      error: "GitHub CLI (gh) not found on PATH"
    };
  }
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim())
    return { available: false, prs: [] };
  const repoRoot = top.stdout.trim();
  const res = await execGh(repoRoot, [
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "30",
    "--json",
    "number,title,state,isDraft,headRefName,baseRefName,headRefOid,author,url"
  ]);
  if (!res.ok) {
    return {
      available: false,
      prs: [],
      error: res.stderr.trim() || "Could not list pull requests via gh"
    };
  }
  try {
    const raw = JSON.parse(res.stdout);
    return {
      available: true,
      prs: raw.map((item) => ({
        number: item.number,
        title: item.title,
        state: item.state.toLowerCase(),
        isDraft: Boolean(item.isDraft),
        headRefName: item.headRefName,
        baseRefName: item.baseRefName,
        headRefOid: item.headRefOid,
        author: item.author?.login ?? "unknown",
        url: item.url
      }))
    };
  } catch (err) {
    return {
      available: false,
      prs: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
};
var mapGithubFileStatus = (status) => {
  switch (status.toLowerCase()) {
    case "added":
      return "A";
    case "removed":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return "M";
  }
};
var PR_GRAPHQL_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        baseRefName
        baseRefOid
        headRefName
        headRefOid
        commits(first: 100) {
          nodes {
            commit {
              oid
              messageHeadline
              committedDate
              author {
                name
                user {
                  login
                }
              }
              parents(first: 1) {
                nodes {
                  oid
                }
              }
            }
          }
        }
        files(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            path
            viewerViewedState
          }
        }
      }
    }
  }
`;
var fetchPrGraphqlMetadata = async (repoRoot, prNumber) => {
  const viewedByPath = new Map;
  const commits = [];
  let pullRequestNodeId = null;
  let baseRefName;
  let baseRefOid;
  let headRefName;
  let headRefOid;
  let cursor = null;
  for (let page = 0;page < 10; page += 1) {
    const args = [
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "repo={repo}",
      "-F",
      `number=${prNumber}`,
      "-f",
      `query=${PR_GRAPHQL_QUERY}`
    ];
    if (cursor) {
      args.push("-F", `cursor=${cursor}`);
    }
    const res = await execGh(repoRoot, args);
    if (!res.ok || !res.stdout.trim())
      break;
    try {
      const parsed = JSON.parse(res.stdout);
      const pr = parsed.data?.repository?.pullRequest;
      if (!pr)
        break;
      if (pr.id)
        pullRequestNodeId = pr.id;
      if (pr.baseRefName)
        baseRefName = pr.baseRefName;
      if (pr.baseRefOid)
        baseRefOid = pr.baseRefOid;
      if (pr.headRefName)
        headRefName = pr.headRefName;
      if (pr.headRefOid)
        headRefOid = pr.headRefOid;
      if (page === 0 && pr.commits?.nodes) {
        for (const node of pr.commits.nodes) {
          const c = node?.commit;
          if (!c?.oid)
            continue;
          commits.push({
            oid: c.oid,
            message: c.messageHeadline ?? c.oid.slice(0, 8),
            author: c.author?.user?.login || c.author?.name || "unknown",
            date: c.committedDate ?? "",
            parentOid: c.parents?.nodes?.[0]?.oid
          });
        }
      }
      for (const fileNode of pr.files?.nodes ?? []) {
        if (fileNode?.path && fileNode.viewerViewedState) {
          viewedByPath.set(fileNode.path, fileNode.viewerViewedState);
        }
      }
      if (pr.files?.pageInfo?.hasNextPage && pr.files.pageInfo.endCursor) {
        cursor = pr.files.pageInfo.endCursor;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return {
    pullRequestNodeId,
    viewedByPath,
    commits,
    baseRefName,
    baseRefOid,
    headRefName,
    headRefOid
  };
};
var setPullRequestFileViewed = async (params) => {
  const { directory, pullRequestNodeId, filePath, viewed } = params;
  if (!pullRequestNodeId || !filePath) {
    throw new Error("pullRequestNodeId and path are required");
  }
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim())
    throw new Error("Not a git repository");
  const repoRoot = top.stdout.trim();
  const mutationName = viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
  const query = `
    mutation($prId: ID!, $path: String!) {
      ${mutationName}(input: { pullRequestId: $prId, path: $path }) {
        clientMutationId
      }
    }
  `;
  const res = await execGh(repoRoot, [
    "api",
    "graphql",
    "-F",
    `prId=${pullRequestNodeId}`,
    "-F",
    `path=${filePath}`,
    "-f",
    `query=${query}`
  ]);
  if (!res.ok) {
    throw new Error(res.stderr.trim() || `Failed to ${mutationName}`);
  }
  if (res.stdout.trim()) {
    const parsed = JSON.parse(res.stdout);
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      throw new Error(parsed.errors[0]?.message || `GraphQL error in ${mutationName}`);
    }
  }
  return {
    ok: true,
    path: filePath,
    viewedState: viewed ? "VIEWED" : "UNVIEWED"
  };
};
var readPullRequestFiles = async (directory, prNumber, fromCommit, toCommit) => {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error("Valid pull request number is required");
  }
  const hasCommitRange = Boolean(fromCommit && toCommit && SHA_RE.test(fromCommit) && SHA_RE.test(toCommit));
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim())
    throw new Error("Not a git repository");
  const repoRoot = top.stdout.trim();
  const [graphqlMeta, metaRes, filesRes] = await Promise.all([
    fetchPrGraphqlMetadata(repoRoot, prNumber),
    execGh(repoRoot, [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "baseRefName,baseRefOid,headRefName,headRefOid"
    ]),
    hasCommitRange ? Promise.resolve(null) : execGh(repoRoot, [
      "api",
      "--paginate",
      "--slurp",
      `repos/{owner}/{repo}/pulls/${prNumber}/files?per_page=100`
    ])
  ]);
  if (!metaRes.ok && !graphqlMeta.baseRefOid) {
    throw new Error(metaRes.stderr.trim() || `Failed to load PR #${prNumber}`);
  }
  const meta = metaRes.ok ? JSON.parse(metaRes.stdout) : {
    baseRefName: graphqlMeta.baseRefName ?? "main",
    baseRefOid: graphqlMeta.baseRefOid ?? "",
    headRefName: graphqlMeta.headRefName ?? "HEAD",
    headRefOid: graphqlMeta.headRefOid ?? ""
  };
  const attachViewed = (list) => list.map((f) => ({
    ...f,
    viewedState: graphqlMeta.viewedByPath.get(f.path) ?? "UNVIEWED"
  }));
  if (hasCommitRange && fromCommit && toCommit) {
    const fromIdx = graphqlMeta.commits.findIndex((c) => c.oid === fromCommit);
    let rangeBaseOid = fromIdx >= 0 ? graphqlMeta.commits[fromIdx]?.parentOid : undefined;
    if (!rangeBaseOid && fromIdx > 0) {
      rangeBaseOid = graphqlMeta.commits[fromIdx - 1]?.oid;
    }
    if (!rangeBaseOid) {
      const parentRes = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${fromCommit}^`]);
      rangeBaseOid = parentRes.ok && parentRes.stdout.trim() ? parentRes.stdout.trim() : meta.baseRefOid;
    }
    const rangeHeadOid = toCommit;
    try {
      const localRange = await readRangeFiles(directory, rangeBaseOid, rangeHeadOid, false);
      return {
        pullRequestNodeId: graphqlMeta.pullRequestNodeId,
        commits: graphqlMeta.commits,
        baseRefName: meta.baseRefName,
        baseRefOid: rangeBaseOid,
        headRefName: meta.headRefName,
        headRefOid: rangeHeadOid,
        files: attachViewed(localRange.files)
      };
    } catch {
      const compareRes = await execGh(repoRoot, [
        "api",
        `repos/{owner}/{repo}/compare/${rangeBaseOid}...${rangeHeadOid}`
      ]);
      if (compareRes.ok && compareRes.stdout.trim()) {
        const compareData = JSON.parse(compareRes.stdout);
        return {
          pullRequestNodeId: graphqlMeta.pullRequestNodeId,
          commits: graphqlMeta.commits,
          baseRefName: meta.baseRefName,
          baseRefOid: rangeBaseOid,
          headRefName: meta.headRefName,
          headRefOid: rangeHeadOid,
          files: attachViewed((compareData.files ?? []).map((f) => ({
            path: f.filename,
            previousPath: f.previous_filename,
            status: mapGithubFileStatus(f.status),
            insertions: f.additions,
            deletions: f.deletions
          })))
        };
      }
      throw new Error(`Failed to load files for commit range ${fromCommit.slice(0, 8)}..${toCommit.slice(0, 8)}`);
    }
  }
  if (filesRes?.ok && filesRes.stdout.trim()) {
    try {
      const parsed = JSON.parse(filesRes.stdout);
      const rawFiles = Array.isArray(parsed[0]) ? parsed.flat() : parsed;
      return {
        ...meta,
        pullRequestNodeId: graphqlMeta.pullRequestNodeId,
        commits: graphqlMeta.commits,
        files: attachViewed(rawFiles.map((f) => ({
          path: f.filename,
          previousPath: f.previous_filename,
          status: mapGithubFileStatus(f.status),
          insertions: f.additions,
          deletions: f.deletions
        })))
      };
    } catch {}
  }
  if (SHA_RE.test(meta.baseRefOid) && SHA_RE.test(meta.headRefOid)) {
    const localRange = await readRangeFiles(directory, meta.baseRefOid, meta.headRefOid, false);
    return {
      ...meta,
      pullRequestNodeId: graphqlMeta.pullRequestNodeId,
      commits: graphqlMeta.commits,
      files: attachViewed(localRange.files)
    };
  }
  throw new Error(filesRes?.stderr.trim() || `Failed to load files for PR #${prNumber}`);
};
var fetchGithubRawFileBuffer = async (repoRoot, filePath, refOid) => {
  if (!SHA_RE.test(refOid))
    return null;
  const encodedPath = filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return execGhBuffer(repoRoot, [
    "api",
    "-H",
    "Accept: application/vnd.github.raw",
    `repos/{owner}/{repo}/contents/${encodedPath}?ref=${refOid}`
  ]);
};
var parseDifftStdout = (out, filePath) => {
  const trimmed = out.trim();
  if (!trimmed)
    return null;
  try {
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const matched = items.find((entry) => entry.path === filePath) ?? items[0] ?? null;
    return matched ? { ...matched, path: filePath } : null;
  } catch {
    const objects = [];
    for (const line of trimmed.split(`
`)) {
      const candidate = line.trim();
      if (!candidate.startsWith("{"))
        continue;
      try {
        objects.push(JSON.parse(candidate));
      } catch {}
    }
    const matched = objects.find((entry) => entry.path === filePath) ?? objects[0] ?? null;
    return matched ? { ...matched, path: filePath } : null;
  }
};
var runDifftTempFiles = async (filePath, original, modified, ignoreComments) => {
  const { bin } = await getDifftInfo();
  if (!bin) {
    return { difft: null, difftError: "difft binary not found on PATH" };
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oc-difft-file-"));
  try {
    const baseName = path.basename(filePath) || "file.txt";
    const oldDir = path.join(tempRoot, "old");
    const newDir = path.join(tempRoot, "new");
    await Promise.all([fs.mkdir(oldDir), fs.mkdir(newDir)]);
    const oldFile = path.join(oldDir, baseName);
    const newFile = path.join(newDir, baseName);
    await Promise.all([
      fs.writeFile(oldFile, original, "utf8"),
      fs.writeFile(newFile, modified, "utf8")
    ]);
    const args = ["--display=json", "--color=never"];
    if (ignoreComments)
      args.push("--ignore-comments");
    args.push(oldFile, newFile);
    const output = await new Promise((resolve) => {
      execFile(bin, args, {
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          DFT_UNSTABLE: "yes"
        }
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, stdout: stdout ?? "", stderr: stderr ?? error.message });
          return;
        }
        resolve({ ok: true, stdout, stderr });
      });
    });
    if (!output.ok || !output.stdout.trim()) {
      return { difft: null, difftError: output.stderr.trim() || "difft execution failed" };
    }
    const item = parseDifftStdout(output.stdout, filePath);
    return item ? { difft: item } : { difft: null, difftError: "Failed to parse difft JSON" };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};
var runGitExtDifft = async (repoRoot, filePath, gitArgs, ignoreComments, allowExitCode1 = false) => {
  const { bin } = await getDifftInfo();
  if (!bin) {
    return { difft: null, difftError: "difft binary not found on PATH" };
  }
  const extraEnv = {
    GIT_EXTERNAL_DIFF: bin,
    DFT_UNSTABLE: "yes",
    DFT_DISPLAY: "json",
    DFT_COLOR: "never"
  };
  if (ignoreComments) {
    extraEnv.DFT_IGNORE_COMMENTS = "1";
  }
  const res = await git(repoRoot, gitArgs, extraEnv);
  const out = res.stdout.trim();
  if (!res.ok && !(allowExitCode1 && res.code === 1 && out)) {
    return {
      difft: null,
      difftError: res.stderr.trim() || "git ext-diff execution failed"
    };
  }
  if (!out) {
    return {
      difft: {
        path: filePath,
        language: "Text",
        status: "unchanged"
      }
    };
  }
  const item = parseDifftStdout(out, filePath);
  return item ? { difft: item } : { difft: null, difftError: "Failed to parse git ext-diff JSON output" };
};
var readFileDiff = async (params) => {
  const {
    directory,
    scope,
    filePath,
    previousPath,
    base,
    head,
    hash,
    includeWorkingTree,
    ignoreComments
  } = params;
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim())
    throw new Error("Not a git repository");
  const repoRoot = top.stdout.trim();
  if (!isSafeRepoRelativePath(repoRoot, filePath)) {
    throw new Error("Invalid file path");
  }
  if (previousPath && !isSafeRepoRelativePath(repoRoot, previousPath)) {
    throw new Error("Invalid previous file path");
  }
  const repoPath = filePath.replace(/\/+$/, "");
  const absPath = path.join(repoRoot, repoPath);
  if (scope === "working" || scope === "staged") {
    const [indexMode, headMode, worktreeEntry] = await Promise.all([
      readGitEntryMode(repoRoot, ["ls-files", "--stage", "-z", "--", `:(literal)${repoPath}`], repoPath),
      readGitEntryMode(repoRoot, ["ls-tree", "-z", "HEAD", "--", repoPath], repoPath),
      fs.lstat(absPath).catch(() => null)
    ]);
    if (indexMode === GITLINK_MODE || headMode === GITLINK_MODE) {
      const submodule = await readSubmoduleState(repoRoot, repoPath, absPath);
      return {
        path: filePath,
        previousPath,
        original: "",
        modified: "",
        isBinary: false,
        isImage: false,
        submodule,
        difft: null
      };
    }
    if (!indexMode && !headMode && worktreeEntry?.isDirectory()) {
      const hasDotGit = await fs.lstat(path.join(absPath, ".git")).then(() => true).catch(() => false);
      return {
        path: filePath,
        previousPath,
        original: "",
        modified: "",
        isBinary: false,
        isImage: false,
        unavailableReason: hasDotGit ? "nested_repository" : "untracked_directory",
        difft: null
      };
    }
  }
  const oldPath = previousPath || filePath;
  const oldRepoPath = oldPath.replace(/\/+$/, "");
  const pathspecArgs = [
    `:(literal)${filePath}`,
    ...previousPath && previousPath !== filePath ? [`:(literal)${previousPath}`] : []
  ];
  let oldBuf = null;
  let newBuf = null;
  let extDiffArgs = null;
  let extDiffAllowExit1 = false;
  if (scope === "staged") {
    oldBuf = await gitBuffer(repoRoot, ["show", `HEAD:${oldPath}`]);
    newBuf = await gitBuffer(repoRoot, ["show", `:${filePath}`]);
    extDiffArgs = ["diff", "--ext-diff", "--cached", "-M", "--", ...pathspecArgs];
  } else if (scope === "working") {
    const trackedRes = await git(repoRoot, [
      "ls-files",
      "--error-unmatch",
      "--",
      `:(literal)${filePath}`
    ]);
    oldBuf = trackedRes.ok ? await gitBuffer(repoRoot, ["show", `:${filePath}`]) ?? (oldPath !== filePath ? await gitBuffer(repoRoot, ["show", `:${oldPath}`]) : null) : previousPath ? await gitBuffer(repoRoot, ["show", `:${oldPath}`]) ?? await gitBuffer(repoRoot, ["show", `HEAD:${oldPath}`]) : null;
    newBuf = await readWorkingTreeBuffer(repoRoot, absPath);
    if (trackedRes.ok) {
      extDiffArgs = ["diff", "--ext-diff", "--", `:(literal)${filePath}`];
    } else if (!oldBuf) {
      extDiffArgs = ["diff", "--ext-diff", "--no-index", "--", "/dev/null", filePath];
      extDiffAllowExit1 = true;
    }
  } else if (scope === "branch") {
    if (!base || !head || !isSafeGitRef(base) || !isSafeGitRef(head)) {
      throw new Error("Valid base and head are required for branch scope");
    }
    const mbRes = await git(repoRoot, ["merge-base", base, head]);
    if (!mbRes.ok || !mbRes.stdout.trim())
      throw new Error("Could not resolve merge-base");
    const mergeBase = mbRes.stdout.trim();
    const [baseEntry, headEntry, worktreeEntry] = await Promise.all([
      readGitEntryInfo(repoRoot, ["ls-tree", "-z", mergeBase, "--", oldRepoPath], oldRepoPath),
      includeWorkingTree ? readGitEntryInfo(repoRoot, ["ls-files", "--stage", "-z", "--", `:(literal)${repoPath}`], repoPath) : readGitEntryInfo(repoRoot, ["ls-tree", "-z", head, "--", repoPath], repoPath),
      includeWorkingTree ? fs.lstat(absPath).catch(() => null) : Promise.resolve(null)
    ]);
    if (baseEntry?.mode === GITLINK_MODE || headEntry?.mode === GITLINK_MODE) {
      const subState = includeWorkingTree ? await readSubmoduleState(repoRoot, repoPath, absPath) : {
        headCommit: baseEntry?.mode === GITLINK_MODE ? baseEntry.hash || null : null,
        indexCommit: headEntry?.mode === GITLINK_MODE ? headEntry.hash || null : null,
        worktreeCommit: headEntry?.mode === GITLINK_MODE ? headEntry.hash || null : null,
        hasTrackedChanges: false,
        hasUntrackedFiles: false,
        hasConflict: false
      };
      return {
        path: filePath,
        previousPath,
        original: "",
        modified: "",
        isBinary: false,
        isImage: false,
        submodule: {
          ...subState,
          headCommit: baseEntry?.mode === GITLINK_MODE ? baseEntry.hash || null : subState.headCommit,
          indexCommit: baseEntry?.mode === GITLINK_MODE ? baseEntry.hash || null : subState.indexCommit
        },
        difft: null
      };
    }
    if (includeWorkingTree && !baseEntry && !headEntry && worktreeEntry?.isDirectory()) {
      const hasDotGit = await fs.lstat(path.join(absPath, ".git")).then(() => true).catch(() => false);
      return {
        path: filePath,
        previousPath,
        original: "",
        modified: "",
        isBinary: false,
        isImage: false,
        unavailableReason: hasDotGit ? "nested_repository" : "untracked_directory",
        difft: null
      };
    }
    oldBuf = await gitBuffer(repoRoot, ["show", `${mergeBase}:${oldPath}`]);
    newBuf = includeWorkingTree ? await readWorkingTreeBuffer(repoRoot, absPath) : await gitBuffer(repoRoot, ["show", `${head}:${filePath}`]);
    if (includeWorkingTree) {
      if (headEntry || baseEntry && !worktreeEntry) {
        extDiffArgs = ["diff", "--ext-diff", "-C", mergeBase, "--", ...pathspecArgs];
      } else if (!baseEntry) {
        extDiffArgs = ["diff", "--ext-diff", "--no-index", "--", "/dev/null", filePath];
        extDiffAllowExit1 = true;
      }
    } else {
      extDiffArgs = ["diff", "--ext-diff", "-C", `${base}...${head}`, "--", ...pathspecArgs];
    }
  } else if (scope === "commit") {
    if (!hash || !SHA_RE.test(hash))
      throw new Error("Valid commit hash is required");
    const parentRes = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${hash}^`]);
    const parentSha = parentRes.ok ? parentRes.stdout.trim() : "";
    const [parentEntry, commitEntry] = await Promise.all([
      parentSha ? readGitEntryInfo(repoRoot, ["ls-tree", "-z", parentSha, "--", oldRepoPath], oldRepoPath) : Promise.resolve(null),
      readGitEntryInfo(repoRoot, ["ls-tree", "-z", hash, "--", repoPath], repoPath)
    ]);
    if (parentEntry?.mode === GITLINK_MODE || commitEntry?.mode === GITLINK_MODE) {
      return {
        path: filePath,
        previousPath,
        original: "",
        modified: "",
        isBinary: false,
        isImage: false,
        submodule: {
          headCommit: parentEntry?.mode === GITLINK_MODE ? parentEntry.hash || null : null,
          indexCommit: parentEntry?.mode === GITLINK_MODE ? parentEntry.hash || null : null,
          worktreeCommit: commitEntry?.mode === GITLINK_MODE ? commitEntry.hash || null : null,
          hasTrackedChanges: false,
          hasUntrackedFiles: false,
          hasConflict: false
        },
        difft: null
      };
    }
    if (parentSha) {
      oldBuf = await gitBuffer(repoRoot, ["show", `${parentSha}:${oldPath}`]);
    }
    newBuf = await gitBuffer(repoRoot, ["show", `${hash}:${filePath}`]);
    extDiffArgs = [
      "show",
      "--format=",
      "--root",
      "--diff-merges=first-parent",
      "--find-renames",
      "--ext-diff",
      hash,
      "--",
      ...pathspecArgs
    ];
  } else if (scope === "pr") {
    if (!base || !head || !isSafeGitRef(base) || !isSafeGitRef(head)) {
      throw new Error("Valid base and head are required for PR scope");
    }
    const mbRes = await git(repoRoot, ["merge-base", base, head]);
    const baseTreeRef = mbRes.ok && mbRes.stdout.trim() ? mbRes.stdout.trim() : base;
    const [baseLocalRes, headLocalRes] = await Promise.all([
      git(repoRoot, ["cat-file", "-e", `${baseTreeRef}^{commit}`]),
      git(repoRoot, ["cat-file", "-e", `${head}^{commit}`])
    ]);
    if (baseLocalRes.ok && headLocalRes.ok) {
      const [baseEntry, headEntry] = await Promise.all([
        readGitEntryInfo(repoRoot, ["ls-tree", "-z", baseTreeRef, "--", oldRepoPath], oldRepoPath),
        readGitEntryInfo(repoRoot, ["ls-tree", "-z", head, "--", repoPath], repoPath)
      ]);
      if (baseEntry?.mode === GITLINK_MODE || headEntry?.mode === GITLINK_MODE) {
        return {
          path: filePath,
          previousPath,
          original: "",
          modified: "",
          isBinary: false,
          isImage: false,
          submodule: {
            headCommit: baseEntry?.mode === GITLINK_MODE ? baseEntry.hash || null : null,
            indexCommit: baseEntry?.mode === GITLINK_MODE ? baseEntry.hash || null : null,
            worktreeCommit: headEntry?.mode === GITLINK_MODE ? headEntry.hash || null : null,
            hasTrackedChanges: false,
            hasUntrackedFiles: false,
            hasConflict: false
          },
          difft: null
        };
      }
      extDiffArgs = ["diff", "--ext-diff", "-C", baseTreeRef, head, "--", ...pathspecArgs];
    }
    oldBuf = baseLocalRes.ok ? await gitBuffer(repoRoot, ["show", `${baseTreeRef}:${oldPath}`]) : await fetchGithubRawFileBuffer(repoRoot, oldPath, base);
    newBuf = headLocalRes.ok ? await gitBuffer(repoRoot, ["show", `${head}:${filePath}`]) : await fetchGithubRawFileBuffer(repoRoot, filePath, head);
  } else {
    throw new Error(`Unknown diff scope: ${scope}`);
  }
  const isImage = isImagePath(filePath);
  if (isImage) {
    const mime = getImageMime(filePath);
    return {
      path: filePath,
      previousPath,
      original: oldBuf && oldBuf.length > 0 ? `data:${mime};base64,${oldBuf.toString("base64")}` : "",
      modified: newBuf && newBuf.length > 0 ? `data:${mime};base64,${newBuf.toString("base64")}` : "",
      isBinary: false,
      isImage: true,
      difft: null
    };
  }
  const isBinary = (oldBuf ? bufferLooksBinary(oldBuf) : false) || (newBuf ? bufferLooksBinary(newBuf) : false);
  if (isBinary) {
    return {
      path: filePath,
      previousPath,
      original: "",
      modified: "",
      isBinary: true,
      isImage: false,
      difft: null
    };
  }
  const original = (oldBuf ? oldBuf.toString("utf8") : "").replace(/\r\n/g, `
`);
  const modified = (newBuf ? newBuf.toString("utf8") : "").replace(/\r\n/g, `
`);
  if (original === "" && modified !== "") {
    return {
      path: filePath,
      previousPath,
      original,
      modified,
      isBinary: false,
      isImage: false,
      difft: {
        path: filePath,
        language: path.extname(filePath).slice(1) || "Text",
        status: "created"
      }
    };
  }
  if (original !== "" && modified === "") {
    return {
      path: filePath,
      previousPath,
      original,
      modified,
      isBinary: false,
      isImage: false,
      difft: {
        path: filePath,
        language: path.extname(filePath).slice(1) || "Text",
        status: "deleted"
      }
    };
  }
  const { difft, difftError } = extDiffArgs ? await runGitExtDifft(repoRoot, filePath, extDiffArgs, ignoreComments, extDiffAllowExit1) : await runDifftTempFiles(filePath, original, modified, ignoreComments);
  return {
    path: filePath,
    previousPath,
    original,
    modified,
    isBinary: false,
    isImage: false,
    difft,
    difftError
  };
};
var sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
var readJsonBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 64 * 1024) {
      reject(new Error("Request body too large"));
    }
  });
  req.on("end", () => {
    try {
      resolve(raw.trim() ? JSON.parse(raw) : {});
    } catch (err) {
      reject(err);
    }
  });
  req.on("error", reject);
});
var server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    getDifftInfo().then((info) => {
      sendJson(res, 200, {
        ok: true,
        difftAvailable: Boolean(info.bin),
        difftVersion: info.version,
        ghAvailable: Boolean(getGhBinary())
      });
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/pr-file-viewed") {
    readJsonBody(req).then(async (body) => {
      const directory = typeof body.directory === "string" ? body.directory : "";
      const pullRequestNodeId = typeof body.pullRequestNodeId === "string" ? body.pullRequestNodeId : "";
      const filePath = typeof body.path === "string" ? body.path : "";
      const viewed = Boolean(body.viewed);
      if (!path.isAbsolute(directory)) {
        sendJson(res, 400, { error: "bad-request", message: "Absolute directory is required" });
        return;
      }
      const data = await setPullRequestFileViewed({
        directory,
        pullRequestNodeId,
        filePath,
        viewed
      });
      sendJson(res, 200, data);
    }).catch((err) => {
      sendJson(res, 500, {
        error: "service-error",
        message: err instanceof Error ? err.message : String(err)
      });
    });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method-not-allowed" });
    return;
  }
  const directory = url.searchParams.get("directory") ?? "";
  if (!path.isAbsolute(directory)) {
    sendJson(res, 400, { error: "bad-request", message: "Absolute directory is required" });
    return;
  }
  const handle = async () => {
    if (url.pathname === "/git-dirs") {
      const data = await findGitDirectories(directory);
      sendJson(res, 200, data);
      return;
    }
    if (url.pathname === "/status") {
      const data = await readStatus(directory);
      sendJson(res, 200, data);
      return;
    }
    if (url.pathname === "/range-files") {
      const base = url.searchParams.get("base") ?? "";
      const head = url.searchParams.get("head") ?? "";
      const includeWorkingTree = url.searchParams.get("includeWorkingTree") === "true";
      if (!base || !head) {
        sendJson(res, 400, { error: "bad-request", message: "base and head are required" });
        return;
      }
      const data = await readRangeFiles(directory, base, head, includeWorkingTree);
      sendJson(res, 200, data);
      return;
    }
    if (url.pathname === "/log") {
      const maxCount = Number.parseInt(url.searchParams.get("maxCount") ?? "50", 10) || 50;
      const to = url.searchParams.get("to") || "HEAD";
      const data = await readLog(directory, maxCount, to);
      sendJson(res, 200, data);
      return;
    }
    if (url.pathname === "/commit-files") {
      const hash = url.searchParams.get("hash") ?? "";
      const data = await readCommitFiles(directory, hash);
      sendJson(res, 200, data);
      return;
    }
    if (url.pathname === "/prs") {
      const data = await readPullRequests(directory);
      sendJson(res, 200, data);
      return;
    }
    if (url.pathname === "/pr-files") {
      const number = Number.parseInt(url.searchParams.get("number") ?? "0", 10);
      const fromCommit = url.searchParams.get("fromCommit") || undefined;
      const toCommit = url.searchParams.get("toCommit") || undefined;
      const data = await readPullRequestFiles(directory, number, fromCommit, toCommit);
      sendJson(res, 200, data);
      return;
    }
    if (url.pathname === "/file-diff") {
      const scope = url.searchParams.get("scope") ?? "working";
      const filePath = url.searchParams.get("path") ?? "";
      const previousPath = url.searchParams.get("previousPath") || undefined;
      const base = url.searchParams.get("base") || undefined;
      const head = url.searchParams.get("head") || undefined;
      const hash = url.searchParams.get("hash") || undefined;
      const includeWorkingTree = url.searchParams.get("includeWorkingTree") !== "false";
      const ignoreComments = url.searchParams.get("ignoreComments") === "true";
      const data = await readFileDiff({
        directory,
        scope,
        filePath,
        previousPath,
        base,
        head,
        hash,
        includeWorkingTree,
        ignoreComments
      });
      sendJson(res, 200, data);
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  };
  handle().catch((err) => {
    sendJson(res, 500, {
      error: "service-error",
      message: err instanceof Error ? err.message : String(err)
    });
  });
});
server.listen(port, "127.0.0.1");
