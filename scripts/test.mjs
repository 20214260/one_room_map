import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve('.test-build');
try {
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'package.json'), '{"type":"commonjs"}');
  const compile = spawnSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      'src/contracts/schemas.ts',
      'src/domain/rooms.ts',
      'src/services/gateway.ts',
      'src/services/mock/data.ts',
      '--outDir',
      out,
      '--module',
      'commonjs',
      '--target',
      'ES2022',
      '--moduleResolution',
      'node',
      '--esModuleInterop',
      '--strict',
      '--skipLibCheck',
    ],
    { stdio: 'inherit' },
  );
  if (compile.status !== 0) process.exitCode = compile.status ?? 1;
  else
    process.exitCode =
      spawnSync(process.execPath, ['--test', 'tests/core.test.cjs'], { stdio: 'inherit' }).status ??
      1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
