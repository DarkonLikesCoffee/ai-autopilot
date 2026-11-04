// Chooses the send button. Shared by the send step and its diagnostics, so the
// diagnostics always report the button the send step would actually use.
//
// Rule: collect the visible matches of the send selectors, in selector order.
// If the message box sits in a form and any match is inside that form, only
// those count: a label such as "Enviar" can also appear on unrelated buttons
// elsewhere on the page. Otherwise the first visible match counts, as before.
// The chosen button is only clicked if it is enabled (checked by the caller).

import { isVisible } from './page.ts';

export interface SendButtonChoice {
  element: HTMLElement;
  selector: string;
  /** Inside the message box's own form. */
  inComposerForm: boolean;
}

function safeAll(doc: Document, selector: string): HTMLElement[] {
  try {
    return Array.from(doc.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

export function findSendButton(doc: Document, sendSelectors: string[], composer: Element | null): SendButtonChoice | null {
  const form = composer?.closest?.('form') ?? null;
  const seen = new Set<HTMLElement>();
  const visible: { element: HTMLElement; selector: string; inForm: boolean }[] = [];
  for (const selector of sendSelectors) {
    for (const element of safeAll(doc, selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      if (!isVisible(element)) continue;
      visible.push({ element, selector, inForm: !!form && form.contains(element) });
    }
  }
  const pick = visible.find((c) => c.inForm) ?? visible[0];
  return pick ? { element: pick.element, selector: pick.selector, inComposerForm: pick.inForm } : null;
}
