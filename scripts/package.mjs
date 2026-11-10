// Builds the release ZIP: node scripts/package.mjs (npm run package).
// 1. Checks that package.json, package-lock.json and static/manifest.json
//    carry the same version (fails otherwise).
// 2. Builds dist/ for release (no source maps).
// 3. Writes release/chatgpt-autopilot-<version>.zip from dist/.
// It never tags or publishes anything (docs/RELEASING.md).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

/** The three versions, and whether they agree. */
export function versions() {
  const pkg = read('package.json').version;
  const lock = read('package-lock.json').version;
  const manifest = read('static/manifest.json').version;
  return { pkg, lock, manifest, consistent: pkg === lock && pkg === manifest };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(' ')} failed`);
    process.exit(result.status ?? 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = versions();
  if (!v.consistent) {
    console.error(`Version mismatch: package.json ${v.pkg}, package-lock.json ${v.lock}, manifest.json ${v.manifest}`);
    process.exit(1);
  }
  run(process.execPath, ['build.mjs', '--release']);
  const maps = readdirSync(`${root}dist`).filter((f) => f.endsWith('.map'));
  if (maps.length) {
    console.error(`Release build contains source maps: ${maps.join(', ')}`);
    process.exit(1);
  }
  mkdirSync(`${root}release`, { recursive: true });
  const out = `${root}release/chatgpt-autopilot-${v.pkg}.zip`;
  rmSync(out, { force: true });
  // -X: no extra file attributes, so the archive depends only on the files.
  run('zip', ['-X', '-r', '-q', out, '.'], { cwd: `${root}dist` });
  console.log(`Wrote ${out}`);
}
