// End-to-end check of the app's real transport (src/main/services/net.ts, bundled to
// transport.cjs) inside Electron, against local https servers. *.example.test and
// *.icloud.com are mapped to 127.0.0.1, so they count as "public" names for the policies.
// The self-signed probe certificate is trusted only in this throwaway session.
//
// Run from the project folder (Git Bash shown; see README "Security"):
//   npx rolldown src/main/services/net.ts -f cjs -p node -e electron -o scripts/transport-probe/transport.cjs
//   MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=probe.example.test" \
//     -addext "subjectAltName=DNS:*.example.test,DNS:*.icloud.com,DNS:localhost,IP:127.0.0.1" \
//     -keyout scripts/transport-probe/key.pem -out scripts/transport-probe/cert.pem
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/transport-probe
// It prints PASS/FAIL per check and exits non-zero if any check fails.
const { app, session } = require('electron');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createTransport } = require('./transport.cjs');

app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.example.test 127.0.0.1, MAP *.icloud.com 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
app.setPath('userData', path.join(__dirname, 'userdata')); // a throwaway profile (ignored by git)

const tls = { key: fs.readFileSync(path.join(__dirname, 'key.pem')), cert: fs.readFileSync(path.join(__dirname, 'cert.pem')) };

function server(handler) {
  const log = [];
  const s = https.createServer(tls, (req, res) => {
    log.push({ path: req.url, auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null });
    handler(req, res);
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ s, log, port: s.address().port })));
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

async function outcome(promise) {
  try {
    const res = await promise;
    const text = await res.text();
    return { ok: true, status: res.status, text, headers: res.headers, url: res.url };
  } catch (err) {
    return { ok: false, name: err.constructor?.name ?? err.name, errName: err.name, message: err.message };
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setCertificateVerifyProc((_req, cb) => cb(0));
  const fetchFn = createTransport({ offline: () => false });

  const target = await server((req, res) => { res.writeHead(200); res.end('target reached'); });
  const tp = target.port;
  const main = await server((req, res) => {
    const u = new URL(req.url, 'https://x');
    switch (u.pathname) {
      case '/cross': res.writeHead(302, { Location: `https://evil.example.test:${tp}/steal` }); return res.end();
      case '/same': res.writeHead(302, { Location: '/final' }); return res.end();
      case '/final': res.writeHead(200); return res.end('final');
      case '/to-private': res.writeHead(302, { Location: `https://127.0.0.1:${tp}/internal` }); return res.end();
      case '/to-public': res.writeHead(302, { Location: `https://other.example.test:${tp}/feed` }); return res.end();
      case '/to-http': res.writeHead(302, { Location: `http://feed.example.test:${tp}/feed` }); return res.end();
      case '/loop': res.writeHead(302, { Location: `/loop?n=${Number(u.searchParams.get('n') ?? 0) + 1}` }); return res.end();
      case '/icloud-out': res.writeHead(302, { Location: `https://evil.example.test:${tp}/steal-apple` }); return res.end();
      case '/icloud-hop': res.writeHead(302, { Location: `https://p02-caldav.icloud.com:${main.port}/final` }); return res.end();
      case '/endless': {
        res.writeHead(200, { 'Content-Type': 'text/calendar' });
        const chunk = Buffer.alloc(256 * 1024, 65);
        const pump = () => { while (res.write(chunk)) { /* fill */ } };
        res.on('drain', pump);
        pump();
        req.on('close', () => res.destroy());
        return;
      }
      case '/declared-huge': res.writeHead(200, { 'Content-Type': 'text/calendar', 'Content-Length': String(50 * 1024 * 1024) }); res.write('x'); return; // never finishes
      case '/declared-huge-untyped': res.writeHead(200, { 'Content-Length': String(50 * 1024 * 1024) }); res.write('x'); return; // no type: Chromium waits to sniff
      case '/gzip-bomb': {
        const bomb = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024, 0));
        res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': String(bomb.length) });
        return res.end(bomb);
      }
      case '/set-cookie': res.writeHead(200, { 'Set-Cookie': 'probe=1; Path=/; Secure; Max-Age=3600' }); return res.end('cookie set');
      case '/check-cookie': res.writeHead(200); return res.end('checked');
      case '/hang': return; // never answers
      case '/basic': res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); return res.end('denied');
      default: res.writeHead(404); return res.end('nope');
    }
  });
  const mp = main.port;
  const host = (name) => `https://${name}:${mp}`;
  const targetHits = (p) => target.log.filter((l) => !p || l.path.startsWith(p)).length;

  // 1. A token is never handed to another server on a redirect.
  let r = await outcome(fetchFn(`${host('canvas.example.test')}/cross`, { headers: { Authorization: 'Bearer SECRET' }, egress: 'credentialed' }));
  record('credentialed cross-origin redirect is refused', !r.ok && r.name === 'BlockedRequestError', r.message);
  record('...and the other server received nothing', targetHits('/steal') === 0, `hits=${targetHits('/steal')}`);

  // 2. Same-origin redirect is followed.
  r = await outcome(fetchFn(`${host('canvas.example.test')}/same`, { headers: { Authorization: 'Bearer SECRET' }, egress: 'credentialed' }));
  record('credentialed same-origin redirect is followed', r.ok && r.text === 'final', r.ok ? `status=${r.status} url=${r.url}` : r.message);
  const finalHit = main.log.find((l) => l.path === '/final');
  console.log(`      (Authorization on the followed same-origin hop: ${finalHit?.auth ? 'sent' : 'not sent'})`);

  // 3. A public feed cannot redirect into the local network.
  r = await outcome(fetchFn(`${host('feed.example.test')}/to-private`, { egress: 'public' }));
  record('public -> 127.0.0.1 redirect is blocked', !r.ok && /local network/.test(r.message), r.message);
  record('...and the local server received nothing', targetHits('/internal') === 0, `hits=${targetHits('/internal')}`);

  // 4. A public feed may move to another public host.
  r = await outcome(fetchFn(`${host('feed.example.test')}/to-public`, { egress: 'public' }));
  record('public -> public redirect is followed', r.ok && r.text === 'target reached', r.ok ? `url=${r.url}` : r.message);

  // 5. No downgrade to http, no endless redirects, 'error' and 'manual' modes.
  r = await outcome(fetchFn(`${host('feed.example.test')}/to-http`, { egress: 'public' }));
  record('redirect to http is refused', !r.ok && /insecure/.test(r.message), r.message);
  r = await outcome(fetchFn(`${host('feed.example.test')}/loop`, { egress: 'public' }));
  record('redirect loop stops after the limit', !r.ok && /too many/.test(r.message), `${r.message} (requests=${main.log.filter((l) => l.path.startsWith('/loop')).length})`);
  r = await outcome(fetchFn(`${host('feed.example.test')}/same`, { egress: 'public', redirect: 'error' }));
  record("redirect: 'error' rejects", !r.ok && r.name === 'BlockedRequestError', r.message);
  r = await outcome(fetchFn(`${host('p01-caldav.icloud.com')}/same`, { egress: 'icloud', redirect: 'manual' }));
  record("redirect: 'manual' hands back the 3xx with its Location", r.ok && r.status === 302 && r.headers.get('location') === '/final', r.ok ? `status=${r.status} location=${r.headers.get('location')}` : r.message);

  // 6. The Apple password only ever goes to iCloud.
  r = await outcome(fetchFn(`https://evil.example.test:${tp}/direct-apple`, { headers: { Authorization: 'Basic QVBQTEU=' }, egress: 'icloud' }));
  record('icloud request to a non-iCloud host is refused before connecting', !r.ok && /only ever sent to iCloud/.test(r.message) && targetHits('/direct-apple') === 0, r.message);
  r = await outcome(fetchFn(`${host('p01-caldav.icloud.com')}/icloud-out`, { headers: { Authorization: 'Basic QVBQTEU=' }, egress: 'icloud' }));
  record('icloud redirect off iCloud is refused', !r.ok && targetHits('/steal-apple') === 0, r.message);
  r = await outcome(fetchFn(`${host('p01-caldav.icloud.com')}/icloud-hop`, { headers: { Authorization: 'Basic QVBQTEU=' }, egress: 'icloud' }));
  record('icloud redirect to another iCloud host is followed', r.ok && r.text === 'final', r.ok ? `url=${r.url}` : r.message);

  // 7. Size limits count what is actually read, after decompression.
  let t0 = Date.now();
  r = await outcome(fetchFn(`${host('feed.example.test')}/endless`, { egress: 'public', maxBytes: 2 * 1024 * 1024 }));
  record('endless body is cut at the size limit', !r.ok && /too large/.test(r.message), `${r.message} after ${Date.now() - t0} ms`);
  t0 = Date.now();
  r = await outcome(fetchFn(`${host('feed.example.test')}/declared-huge`, { egress: 'public', maxBytes: 2 * 1024 * 1024, timeoutMs: 5000 }));
  record('declared oversize Content-Length is refused at once', !r.ok && /too large/.test(r.message), `${r.message} after ${Date.now() - t0} ms`);
  t0 = Date.now();
  r = await outcome(fetchFn(`${host('feed.example.test')}/declared-huge-untyped`, { egress: 'public', maxBytes: 2 * 1024 * 1024, timeoutMs: 3000 }));
  record('...without a Content-Type it is still bounded (cap or deadline)', !r.ok && /too large|timed out/.test(r.message), `${r.message} after ${Date.now() - t0} ms`);
  t0 = Date.now();
  r = await outcome(fetchFn(`${host('feed.example.test')}/gzip-bomb`, { egress: 'public', maxBytes: 2 * 1024 * 1024 }));
  record('64 MB gzip bomb (small on the wire) is cut at 2 MB decoded', !r.ok && /too large/.test(r.message), `${r.message} after ${Date.now() - t0} ms`);

  // 8. Cookies are neither sent nor kept.
  await outcome(fetchFn(`${host('feed.example.test')}/set-cookie`, { egress: 'public' }));
  await outcome(fetchFn(`${host('feed.example.test')}/check-cookie`, { egress: 'public' }));
  const cookieHit = main.log.find((l) => l.path === '/check-cookie');
  const jar = await session.defaultSession.cookies.get({});
  record('a cookie set by a server is not sent back', cookieHit && cookieHit.cookie === null, `cookie header=${cookieHit?.cookie}`);
  record('...and is not stored', jar.length === 0, `jar=${jar.length}`);

  // 9. Deadlines, login prompts, plain http and bad addresses.
  t0 = Date.now();
  r = await outcome(fetchFn(`${host('feed.example.test')}/hang`, { egress: 'public', timeoutMs: 800 }));
  record('a server that never answers times out', !r.ok && r.errName === 'TimeoutError', `${r.message} after ${Date.now() - t0} ms`);
  r = await outcome(fetchFn(`${host('canvas.example.test')}/basic`, { egress: 'credentialed', timeoutMs: 5000 }));
  record('a 401 asking for a password comes back as 401 (no prompt, no hang)', r.ok && r.status === 401, r.ok ? `status=${r.status}` : r.message);
  r = await outcome(fetchFn(`http://feed.example.test:${mp}/final`, { egress: 'public' }));
  record('plain http is refused before connecting', !r.ok && r.name === 'BlockedRequestError', r.message);
  r = await outcome(fetchFn(`https://user:pw@feed.example.test:${mp}/final`, { egress: 'public' }));
  record('credentials inside an address are refused', !r.ok && r.name === 'BlockedRequestError', r.message);

  const failed = results.filter((x) => !x.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  target.s.close();
  main.s.close();
  app.exit(failed ? 1 : 0);
});
