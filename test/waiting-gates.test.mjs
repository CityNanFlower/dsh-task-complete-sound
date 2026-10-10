/**
 * One-shot gate test for dsh-task-complete-sound v0.4.2.
 *
 * Runs the real lib/client.js in a stubbed browser environment (no browser, no
 * network) and drives the pending-interaction watcher directly, asserting what
 * each gate does. Covers the 0.4.2 change: waiting-class events (tool approval,
 * ask_user_question cards, plan reviews) pop the banner even while the page is
 * focused, while completion events keep the old foreground suppression.
 *
 *   node test/waiting-gates.test.mjs
 *
 * Exit code 0 = every assertion passed; 1 = a named failure.
 */
import { boot } from './harness.mjs';

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push({ name, ok, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

const waitingStatus = (pi) => ({ running: false, pendingInteraction: pi, completionUnread: false });
const approval = (key, toolName) => ({ kind: 'approval', key, sessionId: 's1', toolName });
const question = (key) => ({ kind: 'question', key, sessionId: 's1', questions: [{ question: '先做哪一步？' }] });
const planReview = (key) => ({ kind: 'plan-review', key, sessionId: 's1', questions: [{ question: '计划可以吗' }] });

// 1. THE FIX: approval while the page is focused still pops the banner.
{
  const t = boot({ notifyDesktop: true });
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('approval in foreground -> banner pops', t.notifications.length, 1);
  check('approval banner title', t.notifications[0] && t.notifications[0].title.includes('等待审批'), true);
  check('approval banner carries the tool name', t.notifications[0] && t.notifications[0].body.includes('pwsh'), true);
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('same approval re-published -> no duplicate banner', t.notifications.length, 1);
  t.advance(1000);
  t.push([['s1', waitingStatus(approval('a2', 'bash'))]]);
  check('new approval key in the same session -> new banner', t.notifications.length, 2);
  t.restore();
}

// 2. Question and plan-review ride the same channel (option C).
{
  const t = boot({ notifyDesktop: true });
  t.push([['s1', waitingStatus(question('q1'))]]);
  check('question in foreground -> banner pops', t.notifications.length, 1);
  check('question banner title', t.notifications[0].title.includes('等待你的回答'), true);
  check('question banner carries the question text', t.notifications[0].body.includes('先做哪一步？'), true);
  t.advance(1000);
  t.push([['s1', waitingStatus(planReview('p1'))]]);
  check('plan review -> banner pops', t.notifications.length, 2);
  check('plan banner title', t.notifications[1].title.includes('等待确认计划'), true);
  t.restore();
}

// 3. notifyWaitingKinds=false keeps tool approvals only.
{
  const t = boot({ notifyDesktop: true, notifyWaitingKinds: false });
  t.push([['s1', waitingStatus(question('q1'))]]);
  check('question with notifyWaitingKinds=false -> silent', t.notifications.length, 0);
  t.advance(1000);
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('approval still cues with notifyWaitingKinds=false', t.notifications.length, 1);
  t.restore();
}

// 4. notifyWaitingAlways=false restores the pre-0.4.2 foreground suppression.
{
  const t = boot({ notifyDesktop: true, notifyWaitingAlways: false });
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('approval with notifyWaitingAlways=false in foreground -> no banner', t.notifications.length, 0);
  t.restore();
}

// 5. Same switch, hidden page: the old path still banners.
{
  const t = boot({ notifyDesktop: true, notifyWaitingAlways: false }, { visible: false, focused: false });
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('approval with notifyWaitingAlways=false while hidden -> banner', t.notifications.length, 1);
  t.restore();
}

// 6. Completion events keep the foreground gate (no regression of v0.3.7).
{
  const t = boot({ notifyDesktop: true });
  t.mux({ type: 'session/event', sessionId: 's1', event: { type: 'turn/end', data: { reason: 'completed' } } });
  check('turn end in foreground -> still no banner', t.notifications.length, 0);
  t.restore();
}

// 7. Master switch and master enable still win.
{
  const t = boot({ notifyDesktop: false });
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('notifyDesktop=false -> waiting stays banner-free', t.notifications.length, 0);
  t.restore();
}
{
  const t = boot({ notifyDesktop: true, enabled: false });
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('enabled=false -> everything silent', t.notifications.length, 0);
  t.restore();
}

// 8. Quiet hours: banner stays, sound is skipped (sound is stubbed out anyway,
//    so this asserts the notification is not swallowed with the sound).
{
  const hour = new Date().getHours();
  const start = String((hour + 23) % 24).padStart(2, '0') + ':00';
  const end = String((hour + 1) % 24).padStart(2, '0') + ':00';
  const t = boot({ notifyDesktop: true, quietEnabled: true, quietStart: start, quietEnd: end });
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('approval during quiet hours -> banner still pops', t.notifications.length, 1);
  t.restore();
}

// 9. Muted keywords never silence a waiting event.
{
  const t = boot({ notifyDesktop: true, mutedKeywords: ['s1'] });
  t.push([['s1', waitingStatus(approval('a1', 'pwsh'))]]);
  check('muted keyword does not silence a waiting event', t.notifications.length, 1);
  t.restore();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length > 0) {
  for (const f of failed) console.error(`FAILED: ${f.name} -> got ${JSON.stringify(f.actual)}, want ${JSON.stringify(f.expected)}`);
  process.exit(1);
}
