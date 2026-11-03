// service/main.ts
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync, accessSync, constants as fsConstants } from "node:fs";
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
var SHA_RE = /^[0-9a-f]{7,64}$/i;
var isExecutable = (filePath) => {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};
var resolveDifftBinary = () => {
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  const candidates = [
    ...pathDirs.map((dir) => path.join(dir, "difft")),
    "/home/linuxbrew/.linuxbrew/bin/difft",
    "/opt/homebrew/bin/difft",
    "/usr/local/bin/difft",
    path.join(home, ".cargo/bin/difft"),
    path.join(home, ".nix-profile/bin/difft"),
    "/usr/bin/difft"
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
};
var cachedDifftBin;
var cachedDifftVersion = null;
var getDifftInfo = async () => {
  if (cachedDifftBin === undefined) {
    cachedDifftBin = resolveDifftBinary();
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
  const top = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim()) {
    return {
      isGitRepo: false,
      repoRoot: null,
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
  const [branchRes, porcelainRes, stagedNumstatRes, workingNumstatRes, refsRes, remotesRes] = await Promise.all([
    git(repoRoot, ["symbolic-ref", "--short", "-q", "HEAD"]),
    git(repoRoot, ["status", "--porcelain=v1", "-z", "-unormal"]),
    git(repoRoot, ["diff", "--cached", "-M", "--numstat", "-z"]),
    git(repoRoot, ["diff-files", "-M", "--numstat", "-z"]),
    git(repoRoot, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]),
    git(repoRoot, ["remote"])
  ]);
  if (!porcelainRes.ok) {
    throw new Error(porcelainRes.stderr.trim() || "git status failed");
  }
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
    repoRoot,
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
  const mergeBaseRes = await git(repoRoot, ["merge-base", baseRef, headRef]);
  if (!mergeBaseRes.ok || !mergeBaseRes.stdout.trim()) {
    throw new Error(`Could not resolve merge-base between ${baseRef} and ${headRef}`);
  }
  const mergeBase = mergeBaseRes.stdout.trim();
  let nameStatusRaw = "";
  let numstatRaw = "";
  if (includeWorkingTree) {
    const untrackedRes = await git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const untracked = untrackedRes.ok ? untrackedRes.stdout : "";
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
    const sig = includeWorkingTree ? `${mergeBase}:${await readFileSignature(path.join(repoRoot, f.path))}` : mergeBase;
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
var runDifftJson = async (filePath, original, modified, ignoreComments) => {
  const { bin } = await getDifftInfo();
  if (!bin) {
    return { difft: null, difftError: "difft binary not found on PATH" };
  }
  if (original === "" && modified !== "") {
    return {
      difft: {
        path: filePath,
        language: path.extname(filePath).slice(1) || "Text",
        status: "created"
      }
    };
  }
  if (original !== "" && modified === "") {
    return {
      difft: {
        path: filePath,
        language: path.extname(filePath).slice(1) || "Text",
        status: "deleted"
      }
    };
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
    const parsed = JSON.parse(output.stdout.trim());
    const item = Array.isArray(parsed) ? parsed[0] ?? null : parsed;
    if (!item)
      return { difft: null };
    return {
      difft: {
        ...item,
        path: filePath
      }
    };
  } catch (err) {
    return {
      difft: null,
      difftError: err instanceof Error ? err.message : String(err)
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};
var readFileDiff = async (params) => {
  const { directory, scope, filePath, previousPath, base, head, hash, ignoreComments } = params;
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
  const oldPath = previousPath || filePath;
  let oldBuf = null;
  let newBuf = null;
  if (scope === "staged") {
    oldBuf = await gitBuffer(repoRoot, ["show", `HEAD:${oldPath}`]);
    newBuf = await gitBuffer(repoRoot, ["show", `:${filePath}`]);
  } else if (scope === "working") {
    oldBuf = await gitBuffer(repoRoot, ["show", `:${filePath}`]) ?? (oldPath !== filePath ? await gitBuffer(repoRoot, ["show", `:${oldPath}`]) : null) ?? await gitBuffer(repoRoot, ["show", `HEAD:${oldPath}`]);
    newBuf = await readWorkingTreeBuffer(repoRoot, path.join(repoRoot, filePath));
  } else if (scope === "branch") {
    if (!base || !head || !isSafeGitRef(base) || !isSafeGitRef(head)) {
      throw new Error("Valid base and head are required for branch scope");
    }
    const mbRes = await git(repoRoot, ["merge-base", base, head]);
    if (!mbRes.ok || !mbRes.stdout.trim())
      throw new Error("Could not resolve merge-base");
    const mergeBase = mbRes.stdout.trim();
    oldBuf = await gitBuffer(repoRoot, ["show", `${mergeBase}:${oldPath}`]);
    newBuf = await readWorkingTreeBuffer(repoRoot, path.join(repoRoot, filePath));
  } else if (scope === "commit") {
    if (!hash || !SHA_RE.test(hash))
      throw new Error("Valid commit hash is required");
    const parentRes = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${hash}^`]);
    const parentSha = parentRes.ok ? parentRes.stdout.trim() : "";
    if (parentSha) {
      oldBuf = await gitBuffer(repoRoot, ["show", `${parentSha}:${oldPath}`]);
    }
    newBuf = await gitBuffer(repoRoot, ["show", `${hash}:${filePath}`]);
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
  const { difft, difftError } = await runDifftJson(filePath, original, modified, ignoreComments);
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
        difftVersion: info.version
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
    if (url.pathname === "/file-diff") {
      const scope = url.searchParams.get("scope") ?? "working";
      const filePath = url.searchParams.get("path") ?? "";
      const previousPath = url.searchParams.get("previousPath") || undefined;
      const base = url.searchParams.get("base") || undefined;
      const head = url.searchParams.get("head") || undefined;
      const hash = url.searchParams.get("hash") || undefined;
      const ignoreComments = url.searchParams.get("ignoreComments") === "true";
      const data = await readFileDiff({
        directory,
        scope,
        filePath,
        previousPath,
        base,
        head,
        hash,
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
