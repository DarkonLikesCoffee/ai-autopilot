// Settings: defaults, validation and normalization of stored data.

import type { Settings } from './types.ts';

export const DEFAULT_PROMPT = `Continue working on the project.

Read the repository's AUTOPILOT.md to understand the project's objectives, current state, instructions, rules, priorities, and remaining tasks.

Review the current implementation and repository state. Determine the most appropriate next action and execute it.

Work autonomously. Don't just analyze, suggest changes, or provide a plan: actually implement the necessary changes, run relevant tests and checks, fix any issues you discover, and commit your work when appropriate.

Update AUTOPILOT.md to accurately reflect progress, completed tasks, discovered issues, decisions, and the next recommended action.

Continue making meaningful progress. Only stop if the project milestone is complete, you're genuinely blocked, or human input is necessary.`;

export const LIMITS = {
  promptMaxLength: 8000,
  delaySeconds: { min: 0, max: 3600 },
  confirmSeconds: { min: 1, max: 120 },
  maxCycles: { min: 0, max: 100000 },
} as const;

export function defaultSettings(): Settings {
  return { schemaVersion: 2, prompt: DEFAULT_PROMPT, delaySeconds: 10, confirmSeconds: 3, maxCycles: 25, notifications: true };
}

export type SettingsField = Exclude<keyof Settings, 'schemaVersion'>;

export interface SettingsIssue {
  field: SettingsField;
  message: string;
}

export function validateSettings(settings: Settings): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  if (typeof settings.prompt !== 'string' || !settings.prompt.trim()) {
    issues.push({ field: 'prompt', message: 'The continuation prompt cannot be empty.' });
  } else if (settings.prompt.length > LIMITS.promptMaxLength) {
    issues.push({ field: 'prompt', message: `The continuation prompt must be ${LIMITS.promptMaxLength} characters or fewer.` });
  }
  const range = (field: 'delaySeconds' | 'confirmSeconds' | 'maxCycles', label: string) => {
    const value = settings[field];
    const { min, max } = LIMITS[field];
    if (!Number.isInteger(value) || value < min || value > max) issues.push({ field, message: `${label} must be a whole number from ${min} to ${max}.` });
  };
  range('delaySeconds', 'The delay before sending');
  range('confirmSeconds', 'The completion confirmation delay');
  range('maxCycles', 'Maximum cycles');
  if (typeof settings.notifications !== 'boolean') issues.push({ field: 'notifications', message: 'Notifications must be on or off.' });
  return issues;
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Coerces stored data into valid settings; each unusable field falls back to its default. */
export function normalizeSettings(raw: unknown): Settings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  const r = raw as Record<string, unknown>;
  const candidate: Settings = {
    schemaVersion: 2,
    prompt: typeof r.prompt === 'string' ? r.prompt : defaults.prompt,
    delaySeconds: num(r.delaySeconds, defaults.delaySeconds),
    confirmSeconds: num(r.confirmSeconds, defaults.confirmSeconds),
    maxCycles: num(r.maxCycles, defaults.maxCycles),
    notifications: typeof r.notifications === 'boolean' ? r.notifications : defaults.notifications,
  };
  for (const issue of validateSettings(candidate)) {
    (candidate as unknown as Record<string, unknown>)[issue.field] = defaults[issue.field];
  }
  return candidate;
}

export const isUnlimited = (settings: Pick<Settings, 'maxCycles'>): boolean => settings.maxCycles === 0;
