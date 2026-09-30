/**
 * dsh-task-complete-sound - host loader entry.
 *
 * The plugin's behavior is all browser work (watching the session list and
 * playing synthesized cues), but this half carries one real job since v0.3.0:
 * exporting a schemastery Config schema. The settings subsystem registers a
 * persistence namespace for every loaded entry with a schema (ns = the
 * profile entry id), which is what lets the browser half persist the
 * configuration to the host via ctx.remote.settings and share it across
 * browsers / the desktop client instead of localStorage only.
 */

import z from '@deepseek-ai/schemastery';

/** Host-side services this plugin needs (none). */
export const inject = []

/**
 * Mirror of the browser DEFAULTS (lib/client.js). Field names must stay in
 * sync with patchOf() on the client; schemastery applies the same defaults
 * server-side, so a fresh namespace view already carries complete values.
 */
export const Config = z.object({
  enabled: z.boolean().default(true),
  sounds: z.object({
    turnEnd: z.string().default('chime'),
    backgroundDone: z.string().default('ding'),
    approval: z.string().default('bubble'),
    error: z.string().default('error'),
  }).default({ turnEnd: 'chime', backgroundDone: 'ding', approval: 'bubble', error: 'error' }),
  volume: z.number().default(0.6),
  onlyWhenHidden: z.boolean().default(false),
  notifyDesktop: z.boolean().default(false),
  notifyOnlyHidden: z.boolean().default(true),
  skipCurrentTurnEnd: z.boolean().default(false),
  flashTitle: z.boolean().default(true),
  quietEnabled: z.boolean().default(false),
  quietStart: z.string().default('23:00'),
  quietEnd: z.string().default('08:00'),
  minIntervalMs: z.number().default(1500),
  mutedKeywords: z.array(z.string()).default([]),
  debug: z.boolean().default(false),
})

/**
 * Cordis apply: no host-side behavior. The row's presence in the tree is
 * what registers the dsh.client declaration with the web client-module
 * registry, and the Config export is what registers the settings namespace.
 */
export function apply() {}
