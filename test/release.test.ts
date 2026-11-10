// Release packaging guarantees (M5, docs/design/m5-release-quality.md C-2, R-2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('package.json, package-lock.json and manifest.json carry the same version (the package script enforces it too)', () => {
  const version = (path: string) => (JSON.parse(read(path)) as { version: string }).version;
  const v = { pkg: version('package.json'), lock: version('package-lock.json'), manifest: version('static/manifest.json') };
  assert.deepEqual(v, { pkg: '0.3.0', lock: '0.3.0', manifest: '0.3.0' });
  assert.match(read('scripts/package.mjs'), /Version mismatch/);
});

test('CI uploads the ZIP as an artifact but can never tag or publish a release (R-2)', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^permissions:\n  contents: read$/m, 'read-only token');
  assert.match(ci, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(ci, /contents: write|softprops\/action-gh-release|actions\/create-release|gh release|git tag|git push/);
  assert.match(ci, /EXTENSION_DIR=.*node e2e\/extension\.e2e\.mjs/, 'the E2E runs on the unzipped release ZIP');
});

test('the release build has no source maps', () => {
  const build = read('build.mjs');
  assert.match(build, /sourcemap: release \? false : 'linked'/);
  assert.match(read('scripts/package.mjs'), /'--release'/);
});
