/**
 * Shim subset API Vitest, untuk menjalankan test tanpa memasang dependency.
 *
 * Kenapa ini ada: `packages/shared` sengaja tidak punya dependency runtime,
 * jadi idealnya test-nya bisa jalan hanya dengan Node. Tapi file test menulis
 * `import { describe, it, expect } from 'vitest'` karena itulah runner yang
 * dipakai di CI. Shim ini membuat kedua kebutuhan itu bertetangga tanpa
 * menjadi dua sumber kebenaran: ini BUKAN pengganti Vitest, cuma jembatan
 * supaya logika bisa diverifikasi sebelum `pnpm install` selesai.
 *
 * Yang didukung: describe / it / test / it.each / describe.each, dan subset
 * matcher yang dipakai `packages/shared`. Matcher di luar daftar ini akan
 * gagal dengan pesan yang jelas, bukan diam-diam lolos.
 *
 * Jalankan lewat `pnpm test:offline`.
 */
import assert from 'node:assert/strict';

const suites = [];
let current = null;

export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  const previous = current;
  current = suite;
  try {
    fn();
  } finally {
    current = previous;
  }
}

function register(test) {
  if (!current) {
    throw new Error(`${test.name}() dipanggil di luar describe()`);
  }
  current.tests.push(test);
}

export function it(name, fn) {
  register({ name, fn });
}

export const test = it;

it.each = (rows) => (name, fn) => {
  for (const row of rows) {
    const args = Array.isArray(row) ? row : [row];
    register({
      name: name.replace('%s', () => JSON.stringify(args[0])),
      fn: () => fn(...args),
    });
  }
};

describe.each = (rows) => (name, fn) => {
  for (const row of rows) {
    const args = Array.isArray(row) ? row : [row];
    describe(name.replace('%s', () => JSON.stringify(args[0])), () => fn(...args));
  }
};

/** Cetak nilai apa adanya, tanpa mengorbankan ability melihat NaN/-0. */
function show(v) {
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'number' && Object.is(v, -0)) return '-0';
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
}

function deepEqualMessage(actual, expected, verb) {
  return `expected ${show(actual)} ${verb} ${show(expected)}`;
}

export function expect(actual) {
  const matchers = {
    toBe(expected) {
      assert.strictEqual(actual, expected, deepEqualMessage(actual, expected, 'toBe'));
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected, deepEqualMessage(actual, expected, 'toEqual'));
    },
    toStrictEqual(expected) {
      assert.deepStrictEqual(actual, expected, deepEqualMessage(actual, expected, 'toStrictEqual'));
    },
    toBeNull() {
      assert.strictEqual(actual, null, deepEqualMessage(actual, null, 'toBeNull'));
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined, deepEqualMessage(actual, undefined, 'toBeUndefined'));
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined, `expected value to be defined`);
    },
    toBeTruthy() {
      assert.ok(actual, `expected ${show(actual)} toBeTruthy`);
    },
    toBeFalsy() {
      assert.ok(!actual, `expected ${show(actual)} toBeFalsy`);
    },
    toBeGreaterThan(n) {
      assert.ok(actual > n, `expected ${show(actual)} > ${show(n)}`);
    },
    toBeGreaterThanOrEqual(n) {
      assert.ok(actual >= n, `expected ${show(actual)} >= ${show(n)}`);
    },
    toBeLessThan(n) {
      assert.ok(actual < n, `expected ${show(actual)} < ${show(n)}`);
    },
    toBeLessThanOrEqual(n) {
      assert.ok(actual <= n, `expected ${show(actual)} <= ${show(n)}`);
    },
    toBeCloseTo(n, digits = 2) {
      const tolerance = Math.pow(10, -digits) / 2;
      assert.ok(Math.abs(actual - n) < tolerance, `expected ${show(actual)} toBeCloseTo ${show(n)}`);
    },
    toContain(item) {
      const ok = typeof actual === 'string' ? actual.includes(item) : actual.includes(item);
      assert.ok(ok, `expected ${show(actual)} toContain ${show(item)}`);
    },
    toContainEqual(item) {
      assert.ok(
        actual.some((x) => JSON.stringify(x) === JSON.stringify(item)),
        `expected array toContainEqual ${show(item)}`,
      );
    },
    toHaveLength(n) {
      assert.strictEqual(actual.length, n, `expected length ${actual.length} toBe ${n}`);
    },
    toHaveProperty(key) {
      assert.ok(actual != null && key in actual, `expected object toHaveProperty ${String(key)}`);
    },
    toMatch(re) {
      assert.ok(re.test(actual), `expected ${show(actual)} toMatch ${re}`);
    },
    toMatchObject(expected) {
      for (const [k, v] of Object.entries(expected)) {
        assert.deepStrictEqual(actual?.[k], v, `property "${k}": ${deepEqualMessage(actual?.[k], v, 'toMatchObject')}`);
      }
    },
    toBeInstanceOf(cls) {
      assert.ok(actual instanceof cls, `expected instance of ${cls.name}`);
    },
    toThrow(expected) {
      assert.strictEqual(typeof actual, 'function', 'toThrow() butuh fungsi, bukan nilai');
      assert.throws(actual, expected instanceof RegExp ? expected : undefined);
    },
    get not() {
      return {
        toBe(expected) {
          assert.notStrictEqual(actual, expected, `expected ${show(actual)} NOT toBe ${show(expected)}`);
        },
        toEqual(expected) {
          assert.notDeepStrictEqual(actual, expected, `expected ${show(actual)} NOT toEqual ${show(expected)}`);
        },
        toBeNull() {
          assert.notStrictEqual(actual, null, `expected ${show(actual)} NOT toBeNull`);
        },
        toBeUndefined() {
          assert.notStrictEqual(actual, undefined, `expected ${show(actual)} NOT toBeUndefined`);
        },
        toContain(item) {
          assert.ok(!actual.includes(item), `expected ${show(actual)} NOT toContain ${show(item)}`);
        },
        toThrow(expected) {
          assert.doesNotThrow(actual, expected instanceof RegExp ? String(expected) : undefined);
        },
      };
    },
  };

  return new Proxy(matchers, {
    get(target, prop) {
      if (prop in target) return target[prop];
      throw new Error(
        `Matcher "${String(prop)}" belum ada di shim offline. ` +
          'Tambahkan ke scripts/offline/vitest-shim.mjs, atau jalankan test ' +
          'lewat vitest (pnpm test) yang matcher lengkapnya sudah tersedia.',
      );
    },
  });
}

export async function runAll() {
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed++;
      } catch (error) {
        failures.push({ suite: suite.name, test: t.name, error });
      }
    }
  }

  return { passed, failures, suiteCount: suites.length };
}

export function report({ passed, failures, suiteCount }) {
  for (const f of failures) {
    console.log(`FAIL  ${f.suite} > ${f.test}`);
    const message = f.error instanceof Error ? f.error.message : String(f.error);
    console.log(
      `      ${message.split('\n').slice(0, 6).join('\n      ')}`,
    );
  }
  const total = passed + failures.length;
  console.log(
    `\n${passed}/${total} passed` +
      (failures.length ? `, ${failures.length} failed` : '') +
      `, ${suiteCount} suite`,
  );
  return failures.length;
}