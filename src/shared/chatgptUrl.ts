// The one ChatGPT address Autopilot works on. chat.openai.com was removed in
// M5 (decision D-7): live check D7-L1 (owner, 2026-11-11) showed that it always
// redirects to chatgpt.com, so ChatGPT is never used at that address.

export const CHATGPT_HOST = 'chatgpt.com';

/** Match patterns for chrome.tabs.query; the same as the manifest's host permission and content-script matches. */
export const CHATGPT_PATTERNS: readonly string[] = Object.freeze([`https://${CHATGPT_HOST}/*`]);

/** True only for an https page on chatgpt.com itself (not a subdomain, not another host). */
export function isChatgptUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname === CHATGPT_HOST;
  } catch {
    return false;
  }
}
