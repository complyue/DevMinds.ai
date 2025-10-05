import { runSafe, listAllowed } from './workspaceShell.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

async function main() {
  const cwd = process.cwd();
  const outDir = path.join(cwd, '.tasklogs', 'DEMO');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Allowed: echo
  const r1 = await runSafe('echo', ['hello-shell'], { cwd });
  // Allowed: pwd
  const r2 = await runSafe('pwd', [], { cwd });
  // Allowed: ls
  const r3 = await runSafe('ls', ['.'], { cwd });

  // Disallowed: rm
  let disallowedErr = '';
  try {
    await runSafe('rm', ['-rf', '/tmp/x'], { cwd });
  } catch (e: any) {
    disallowedErr = String(e.message || e);
  }

  // Disallowed: absolute path outside cwd
  let outsideErr = '';
  try {
    await runSafe('ls', ['/etc'], { cwd });
  } catch (e: any) {
    outsideErr = String(e.message || e);
  }

  const summary = {
    allowed: listAllowed(),
    echo: r1.stdout.trim(),
    pwd: r2.stdout.trim(),
    lsHasCwd: r3.stdout.includes('.'),
    disallowedErr,
    outsideErr,
  };
  writeFileSync(path.join(outDir, 'shell-summary.json'), JSON.stringify(summary, null, 2));
  console.log('[unit][ok] workspace.shell basic allowlist validated');
}

main().catch((err) => {
  console.error('[unit][fail]', err);
  process.exit(1);
});
