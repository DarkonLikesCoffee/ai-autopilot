// M5 C-8: the panel's Page line, built only from structure signals.

import test from 'node:test';
import assert from 'node:assert/strict';
import { interfaceLanguage, readSignals } from '../src/content/page.ts';
import { DEFAULT_SELECTORS } from '../src/content/selectors.ts';
import { isLanguageTag, isPageObservation } from '../src/shared/messages.ts';
import { pageCheck } from '../src/ui/viewModel.ts';
import { fakePage, obs } from './helpers/fixtures.ts';

const page = (over: Partial<NonNullable<Parameters<typeof pageCheck>[0]>> = {}) => ({
  composerFound: true, composerHasText: false, sendControlFound: true, stopControlFound: false, assistantMessageCount: 3, interfaceLanguage: 'en-US', ...over,
});

test('C-8: a recognized page lists what was found', () => {
  assert.deepEqual(pageCheck(page()), { recognized: true, text: 'Recognized: message box, Send button, 3 answers; language en-US.' });
  assert.equal(pageCheck(page({ stopControlFound: true, sendControlFound: false, assistantMessageCount: 1 }))?.text, 'Recognized: message box, Stop button, 1 answer; language en-US.');
  assert.equal(pageCheck(page({ assistantMessageCount: 0, interfaceLanguage: null }))?.text, 'Recognized: message box, Send button, no answers yet; language not set.');
  assert.equal(pageCheck(null), null, 'no tab or no connection: no Page line');
});

test('C-8: a missing Send button is reported only while the message box has text', () => {
  const empty = pageCheck(page({ sendControlFound: false }));
  assert.equal(empty?.recognized, true, 'an empty box is not a warning: live, ChatGPT shows no Send button for it (PC-L1)');
  assert.match(empty?.text ?? '', /The Send button is checked once the message box has text\.$/);
  const typed = pageCheck(page({ sendControlFound: false, composerHasText: true }));
  assert.deepEqual(typed, { recognized: false, text: 'This ChatGPT page is not fully recognized (Send button not found). Copy the diagnostic report from Activity when you report it.' });
  assert.equal(pageCheck(page({ composerHasText: true }))?.recognized, true);
});

test('C-8: a missing message box is reported', () => {
  const none = pageCheck(page({ composerFound: false, sendControlFound: false }));
  assert.equal(none?.recognized, false);
  assert.match(none?.text ?? '', /\(message box not found\)/);
});

test('C-8: the interface language comes from <html lang>, as a language tag only', () => {
  const withLang = (lang: string | null) => ({ querySelectorAll: () => [], documentElement: { getAttribute: (name: string) => (name === 'lang' ? lang : null) } });
  assert.equal(interfaceLanguage(withLang('es-ES')), 'es-ES');
  assert.equal(interfaceLanguage(withLang(' en ')), 'en');
  assert.equal(interfaceLanguage(withLang('')), null);
  assert.equal(interfaceLanguage(withLang(null)), null);
  assert.equal(interfaceLanguage(withLang('not a language tag at all')), null);
  assert.equal(interfaceLanguage({ querySelectorAll: () => [] }), null, 'no document element');
  assert.equal(readSignals(fakePage({}), DEFAULT_SELECTORS).signals.interfaceLanguage, null);
});

test('C-8: an observation carrying anything but a language tag is rejected', () => {
  for (const ok of ['en', 'es-ES', 'zh-Hant-TW', null, undefined]) {
    assert.equal(isPageObservation(obs('idle', null, undefined, { interfaceLanguage: ok as string | null })), true, String(ok));
  }
  for (const bad of ['Hello, this is my message', 'x'.repeat(40), 42, 'en_US', '<b>en</b>']) {
    assert.equal(isPageObservation(obs('idle', null, undefined, { interfaceLanguage: bad as never })), false, String(bad));
  }
  assert.equal(isLanguageTag('e'), false);
});
