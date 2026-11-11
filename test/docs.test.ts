// M5 C-9: the user documentation stays in step with the code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { HALT_GUIDANCE, HALT_KIND_LABEL } from '../src/shared/guidance.ts';
import { haltSentence } from '../src/shared/session.ts';
import type { HaltReason } from '../src/shared/types.ts';

const readme = readFileSync('README.md', 'utf8');
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

test('the README troubleshooting table has every halt, with the panel\'s exact words', () => {
  const section = readme.slice(readme.indexOf('## Troubleshooting'), readme.indexOf('## Known limitations'));
  assert.ok(section.length > 100, 'the section exists');
  for (const [reason, g] of Object.entries(HALT_GUIDANCE) as [HaltReason, typeof HALT_GUIDANCE[HaltReason]][]) {
    const row = `| ${haltSentence(reason, null)} | ${HALT_KIND_LABEL[g.kind]} | ${g.action} |`;
    assert.ok(section.includes(row), `README is missing or out of date for ${reason}:\n${row}`);
  }
});

test('licence, changelog and release notes exist for this version', () => {
  const licence = readFileSync('LICENSE', 'utf8');
  assert.match(licence, /^MIT License/);
  assert.match(licence, /Copyright \(c\) 2026 DarkonLikesCoffee/);
  assert.equal((JSON.parse(readFileSync('package.json', 'utf8')) as { license?: string }).license, 'MIT');
  assert.match(readFileSync('build.mjs', 'utf8'), /cp\(`\$\{root\}LICENSE`/, 'the licence is copied into every build, so the ZIP carries it');
  assert.match(readFileSync('CHANGELOG.md', 'utf8'), new RegExp(`^## ${version.replace(/\./g, '\\.')} `, 'm'), 'CHANGELOG has a section for this version');
  assert.ok(existsSync(`docs/releases/${version}.md`), 'release notes for this version');
});

test('the README is a user guide; developer material lives in docs/DEVELOPMENT.md', () => {
  for (const heading of ['## Install', '## First use', '## The control panel', '## Safeguards', '## Stop on status marker', '## Privacy', '## Troubleshooting', '## Known limitations']) {
    assert.ok(readme.includes(heading), heading);
  }
  assert.ok(!readme.includes('npm run'), 'no build commands in the user guide');
  assert.match(readFileSync('docs/DEVELOPMENT.md', 'utf8'), /npm run check/);
});
