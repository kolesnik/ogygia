/**
 * Each node test file's build cache is its own, and starts empty (test: build-cache.test.ts): the
 * fences and markup a file renders are rendered, never read back from what an earlier run left in
 * the package's node_modules/.ogygia. A test that sets its own root (or none) still does.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { __set_build_cache_root } from '@ogygia/compiler';

const root = mkdtempSync(join(tmpdir(), 'og-content-cache-'));
__set_build_cache_root(root);
afterAll(() => rmSync(root, { recursive: true, force: true }));
