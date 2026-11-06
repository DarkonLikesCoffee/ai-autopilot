// Source scan (M3 design, P4 and P6): code that runs on ChatGPT pages
// (src/content) may read page text only where reviewed. A new read of
// innerText, textContent, nodeValue or value fails this test until it is
// reviewed and added here. statusMarker.ts must keep no module-level state.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../src/content/', import.meta.url);

/** Reviewed text reads per file, and why. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'composer.ts': { count: 4, why: 'the message box text, to verify the typed prompt and never touch user text' },
  'page.ts': { count: 5, why: 'short notice texts (matched and discarded) and whether the message box has text' },
  'sendDiagnostics.ts': { count: 5, why: 'message-box text length and holds-prompt flag (never the text)' },
  'statusMarker.ts': { count: 1, why: 'visible answer text for the exact marker comparison (opt-in, R9/R10)' },
};

const READ = /\.(innerText|textContent|nodeValue|value)\b/g;

test('page text is read only in reviewed places', () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(new URL(file, DIR), 'utf8');
    const count = (source.match(READ) ?? []).length;
    const allowed = ALLOWED[file]?.count ?? 0;
    assert.equal(count, allowed, `${file}: ${count} text read(s), ${allowed} reviewed. Review the new read for privacy and update ALLOWED.`);
  }
});

test('the status-marker reader keeps no module-level state', () => {
  const source = readFileSync(new URL('statusMarker.ts', DIR), 'utf8');
  const topLevel = source.split('\n').filter((line) => /^(let|var)\s/.test(line) || /^export\s+(let|var)\s/.test(line));
  assert.deepEqual(topLevel, []);
});
