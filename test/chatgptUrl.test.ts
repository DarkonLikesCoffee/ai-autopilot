// D-7: chatgpt.com keeps working; the obsolete chat.openai.com is no longer accepted
// anywhere (manifest, tab patterns, message senders).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHATGPT_PATTERNS, isChatgptUrl } from '../src/shared/chatgptUrl.ts';

const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8')) as {
  host_permissions: string[];
  content_scripts: { matches: string[] }[];
  permissions: string[];
};

test('D-7: chatgpt.com pages are accepted', () => {
  for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/c/abc-123', 'https://chatgpt.com/?model=x', 'https://chatgpt.com/g/g-123/c/abc']) {
    assert.equal(isChatgptUrl(url), true, url);
  }
});

test('D-7: chat.openai.com and every other address are not accepted', () => {
  for (const url of [
    'https://chat.openai.com/',
    'https://chat.openai.com/c/abc-123',
    'http://chatgpt.com/c/abc', // not https
    'https://www.chatgpt.com/c/abc', // a subdomain
    'https://chatgpt.com.example.com/c/abc',
    'https://example.com/chatgpt.com',
    'https://openai.com/',
    'chrome-extension://abc/sidepanel.html',
    'not a url',
    '',
    undefined,
  ]) {
    assert.equal(isChatgptUrl(url), false, String(url));
  }
});

test('D-7: the manifest grants and injects into chatgpt.com only, matching the tab patterns', () => {
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
  assert.deepEqual(manifest.content_scripts.map((c) => c.matches), [['https://chatgpt.com/*']]);
  assert.deepEqual([...CHATGPT_PATTERNS], manifest.host_permissions, 'the tab query uses exactly the granted hosts');
  assert.ok(!JSON.stringify(manifest).includes('openai.com'), 'no openai.com address anywhere in the manifest');
});

test('D-7: no source file still accepts chat.openai.com', () => {
  for (const file of ['src/background/index.ts', 'src/background/controller.ts', 'src/shared/chatgptUrl.ts', 'src/content/index.ts', 'src/content/page.ts', 'src/shared/session.ts']) {
    const code = readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('chat.openai.com'), `${file} still refers to chat.openai.com`);
  }
});
