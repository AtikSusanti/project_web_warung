/**
 * Runner test offline untuk `packages/shared`.
 *
 * Menjalankan file `*.test.ts` di packages/shared tanpa `pnpm install`:
 *
 *   node --experimental-transform-types --no-warnings scripts/offline/run.mjs
 *   pnpm test:offline
 *
 * Dua hal yang diselesaikan oleh hook di bawah, keduanya konsekuensi dari
 *|source code| ditulis untuk toolchain TypeScript penuh (tsup/vitest/tsc):
 *
 * 1. Import relatif ditulis sebagai `./money.js`, bukan `./money.ts`. Itu
 *    konvensi wajib untuk output ESM: Node mencari file `.js` sungguhan saat
 *    runtime, dan di repo ini yang ada adalah `.ts`. TypeScript
 *    me-resolve-nya ke `.ts`; Node tidak. Hook di sini meniru perilaku itu.
 *
 * 2. `import ... from 'vitest'` di-resolve ke shim lokal, supaya tidak perlu
 *    Vitest terpasang.
 *
 * Batasnya jelas: ini memeriksa logika, bukan tipe. TypeScript dan ESLint
 * tetap wajib jalan lewat `pnpm typecheck` / `pnpm lint` setelah dependency
 * terpasang. Test yang butuh dependency nyata (koneksi database, HTTP) tidak
 * bisa dijalankan di sini dan sengaja tidak ada di packages/shared.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const shimUrl = pathToFileURL(join(here, 'vitest-shim.mjs')).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // 1. alias vitest ke shim
    if (specifier === 'vitest') {
      return { url: shimUrl, shortCircuit: true };
    }

    // 2. './foo.js' -> './foo.ts' kalau file .ts-nya memang ada
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const asTs = specifier.replace(/\.js$/, '.ts');
      const candidate = new URL(asTs, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(asTs, context);
      }
    }

    return nextResolve(specifier, context);
  },
});

const { runAll, report } = await import(shimUrl);

const sharedSrc = join(repoRoot, 'packages', 'shared', 'src');

async function findTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...(await findTestFiles(full)));
    } else if (entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

const files = await findTestFiles(sharedSrc);
if (files.length === 0) {
  console.log('Tidak ada file *.test.ts di packages/shared/src');
  process.exit(0);
}

for (const file of files) {
  await import(pathToFileURL(file).href);
}

process.exit(report(await runAll()) === 0 ? 0 : 1);