/**
 * Live serving check: does the running GUI hand the browser the NEW client half?
 *
 * Fetches the shell with the session token, extracts this plugin's client
 * module URL from the module registry, downloads it and asserts the 0.4.2 code
 * is what the page would execute. Also reads the web-all degraded list so a
 * silently dropped plugin cannot pass unnoticed.
 *
 *   node test/live-serve-check.mjs <token>
 */
import http from 'node:http';

function get(path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 3080, path, headers: cookie ? { cookie } : {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const token = process.argv[2];
if (!token) { console.error('usage: node test/live-serve-check.mjs <token>'); process.exit(2); }

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

let shell = await get('/?token=' + token);
const cookie = (shell.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
// The token exchange answers 303 to the clean URL; follow it once with the cookie.
if (shell.status >= 300 && shell.status < 400 && shell.headers.location) {
  const loc = new URL(shell.headers.location, 'http://127.0.0.1:3080');
  shell = await get(loc.pathname + loc.search, cookie);
}
check('shell served with token', shell.status === 200 && shell.body.length > 1000, `status ${shell.status}, ${shell.body.length} bytes`);

const entry = shell.body.match(/\{[^{}]*"id":"@local\/dsh-task-complete-sound"[^{}]*\}/);
const url = entry && entry[0].match(/"url":"([^"]+)"/);
check('plugin registered in the client module registry', !!url, entry ? entry[0].slice(0, 160) : 'entry not found in shell HTML');

if (url) {
  const raw = url[1].replace(/&amp;/g, '&');
  const mod = await get(raw.startsWith('/') ? raw : '/' + raw, cookie);
  check('client module downloaded', mod.status === 200 && mod.body.length > 10000, `status ${mod.status}, ${mod.body.length} bytes`);
  check('served client half carries the 0.4.2 waiting path', mod.body.includes('notifyWaitingAlways') && mod.body.includes('plan-review'), '');
}

const degraded = await get('/api/dsh-web-all/degraded', cookie);
check('web-all degraded list is empty', /"degraded":\[\]/.test(degraded.body), degraded.body.slice(0, 120));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
