import { spawn } from 'child_process';

export type AllowedCmd = 'echo' | 'ls' | 'cat' | 'pwd';
export interface ShellOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}
export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

const ALLOWLIST: AllowedCmd[] = ['echo', 'ls', 'cat', 'pwd'];

function isAllowed(cmd: string): cmd is AllowedCmd {
  return ALLOWLIST.includes(cmd as AllowedCmd);
}

export async function runSafe(
  cmd: string,
  args: string[] = [],
  opts: ShellOptions,
): Promise<ShellResult> {
  if (!isAllowed(cmd)) {
    throw new Error(`Command not allowed: ${cmd}`);
  }
  // Basic path guard: disallow args that look like absolute paths outside cwd
  const absOutside = args.some((a) => /^\/(bin|etc|usr|var|tmp|sbin)/.test(a));
  if (absOutside) {
    throw new Error('Path outside workspace not allowed');
  }
  const timeout = opts.timeoutMs ?? 3000;

  return new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      reject(new Error('Command timed out'));
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // truncate outputs for safety
      const limit = 10 * 1024;
      resolve({ code: code ?? 0, stdout: stdout.slice(0, limit), stderr: stderr.slice(0, limit) });
    });
  });
}

export function listAllowed(): string[] {
  return [...ALLOWLIST];
}
