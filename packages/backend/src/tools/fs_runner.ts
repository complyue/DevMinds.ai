import {
  writeTextAtomicSafe,
  writeJsonAtomicSafe,
  readTextSafe,
  fileExistsSafe,
} from './workspaceFs.js';

function arg(name: string, def?: string) {
  const a = process.argv.find((v) => v.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

async function main() {
  const okPath = arg('okPath', '.minds/tools-fs-unit.txt')!;
  const badPath = arg('badPath', '../outside.txt')!;

  let okAllowed = false;
  let badDenied = false;
  let readBack = '';

  try {
    await writeTextAtomicSafe(okPath, 'hello-tools-fs');
    okAllowed = true;
    readBack = await readTextSafe(okPath);
  } catch (e) {
    okAllowed = false;
  }

  try {
    await writeJsonAtomicSafe(badPath, { x: 1 });
    badDenied = false;
  } catch (e) {
    badDenied = true;
  }

  const exists = await fileExistsSafe(okPath).catch(() => false);
  const out = { okAllowed, badDenied, readBack, exists };
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(
    JSON.stringify({ okAllowed: false, badDenied: false, error: String(e?.message || e) }),
  );
  process.exit(1);
});
