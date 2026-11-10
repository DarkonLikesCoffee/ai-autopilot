// The settings form as plain values (M5 C-6): parsing, per-field issues and the
// unsaved check. Pure, so it can be tested without a DOM.

import { validateSettings, type SettingsField } from '../shared/settings.ts';
import type { Settings } from '../shared/types.ts';

/** What the form holds, exactly as typed. */
export interface FormValues {
  prompt: string;
  delaySeconds: string;
  confirmSeconds: string;
  maxCycles: string;
  unlimited: boolean;
  notifications: boolean;
  stopOnMarker: boolean;
}

/** The form control that shows each field's issue. */
export const FIELD_INPUT: Readonly<Record<SettingsField, string>> = Object.freeze({
  prompt: 's-prompt',
  delaySeconds: 's-delay',
  confirmSeconds: 's-confirm',
  maxCycles: 's-max',
  notifications: 's-notify',
  stopOnMarker: 's-stop-marker',
});

/** An empty or non-numeric box is NaN (invalid), never 0. */
function number(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

export function parseForm(values: FormValues): Settings {
  return {
    schemaVersion: 2,
    prompt: values.prompt,
    delaySeconds: number(values.delaySeconds),
    confirmSeconds: number(values.confirmSeconds),
    maxCycles: values.unlimited ? 0 : number(values.maxCycles),
    notifications: values.notifications,
    stopOnMarker: values.stopOnMarker,
  };
}

/** The values the form shows for saved settings. */
export function formValues(settings: Settings): FormValues {
  const unlimited = settings.maxCycles === 0;
  return {
    prompt: settings.prompt,
    delaySeconds: String(settings.delaySeconds),
    confirmSeconds: String(settings.confirmSeconds),
    maxCycles: unlimited ? '' : String(settings.maxCycles),
    unlimited,
    notifications: settings.notifications,
    stopOnMarker: settings.stopOnMarker,
  };
}

/** One message per invalid field (the first issue of each), in form order. */
export function fieldIssues(values: FormValues): Partial<Record<SettingsField, string>> {
  const issues: Partial<Record<SettingsField, string>> = {};
  for (const issue of validateSettings(parseForm(values))) issues[issue.field] ??= issue.message;
  return issues;
}

/** True when saving the form would change the saved settings. */
export function hasUnsavedChanges(values: FormValues, saved: Settings): boolean {
  const current = parseForm(values);
  return (Object.keys(FIELD_INPUT) as SettingsField[]).some((field) => !Object.is(current[field], saved[field]));
}
