import { promises as fs } from 'fs';
import path from 'path';

const repoRoot = process.cwd();

// Allowed roots under the current working directory (tests workspace)
const allowedRoots = ['.minds', '.tasklogs'].map((p) => path.resolve(repoRoot, p));

function isUnder(target: string, base: string) {
  const t = path.resolve(target);
  const b = path.resolve(base);
  return t === b || t.startsWith(b + path.sep);
}

function resolveSafePath(relOrAbs: string) {
  const p = path.resolve(repoRoot, relOrAbs);
  // Permit only paths under allowed roots
  for (const root of allowedRoots) {
    if (isUnder(p, root)) return p;
  }
  throw new Error(`workspace.fs: path not allowed: ${relOrAbs}`);
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true }).catch(() => {});
}

export async function writeTextAtomicSafe(relPath: string, content: string) {
  const fp = resolveSafePath(relPath);
  await ensureDir(path.dirname(fp));
  const tmp = fp + '.tmp';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, fp);
}

export async function writeJsonAtomicSafe(relPath: string, obj: any) {
  const fp = resolveSafePath(relPath);
  await ensureDir(path.dirname(fp));
  const tmp = fp + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, fp);
}

export async function readTextSafe(relPath: string) {
  const fp = resolveSafePath(relPath);
  return fs.readFile(fp, 'utf8');
}

export async function fileExistsSafe(relPath: string) {
  const fp = resolveSafePath(relPath);
  try {
    await fs.access(fp);
    return true;
  } catch {
    return false;
  }
}
