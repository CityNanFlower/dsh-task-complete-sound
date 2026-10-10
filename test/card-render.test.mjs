/**
 * Settings-card render test for dsh-task-complete-sound v0.4.2.
 *
 * Renders the real SoundSettingsCard (captured from the plugin's slot
 * registration) with a minimal React face, expanded, and asserts the new
 * waiting switches and their copy actually appear. This is the guard for the
 * v0.3.4 class of bug: a card that throws or falls back to raw copy keys.
 *
 *   node test/card-render.test.mjs
 */
import { boot, renderText } from './harness.mjs';

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push({ name, ok, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

// useState call order in SoundSettingsCard: open, draft, saving, flash, permTick, testResult.
const EXPANDED = [true, null, false, false, 0, null];

{
  const t = boot({ notifyDesktop: true }, { stateQueue: EXPANDED });
  check('settings card component captured', typeof t.card, 'function');
  const text = renderText(t.card({}));
  check('card renders the always-banner switch', text.includes('等待类事件始终弹横幅'), true);
  check('card renders the waiting-kinds switch', text.includes('等待回答 / 计划确认也提醒'), true);
  check('card renders the renamed waiting sound row', text.includes('等待提醒音效'), true);
  check('card renders the waiting banner hint', text.includes('不受此限制'), true);
  check('card copy complete (no raw key fallthrough)', /notifyWaiting|soundApproval|gate_|notifyQuestion|notifyPlan/.test(text), false);
  t.restore();
}

// With desktop notifications off the always-banner switch is intentionally hidden.
{
  const t = boot({ notifyDesktop: false }, { stateQueue: EXPANDED });
  const text = renderText(t.card({}));
  check('always-banner switch hidden while desktop notifications are off', text.includes('等待类事件始终弹横幅'), false);
  check('waiting-kinds switch still rendered', text.includes('等待回答 / 计划确认也提醒'), true);
  t.restore();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length > 0) {
  for (const f of failed) console.error(`FAILED: ${f.name} -> got ${JSON.stringify(f.actual)}, want ${JSON.stringify(f.expected)}`);
  process.exit(1);
}
