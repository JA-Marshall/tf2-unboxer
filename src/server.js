// tf2-unboxer: one small web server. It serves the pages in public/ and a JSON API:
//   GET  /api/state            the account, what it can open, and the log of opened cases (newest first)
//   POST /api/open             { case, key, count }: opens `count` cases. The ONLY route that spends anything.
//   GET  /api/sample           a demo batch of sample items (opens nothing)
//   POST /api/prices           { names }: Steam Market prices (optional, PRICES=off turns them off)
//   GET  /api/pnl              profit and loss of every session in the log
// Configured by environment variables: see README.md and .env.example.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { demoBench, steamBench } from './bench.js';
import { logView, sampleBatch, sampleKinds, LANES } from './show.js';
import { createPrices } from './prices.js';
import { unboxPnl, pnlNames } from './pnl.js';
import { likelyKey } from './items.js';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const PORT = Number(env('PORT', '8080')) || 8080;
const DATA_DIR = path.resolve(env('DATA_DIR', '/data'));
// a Steam Desktop Authenticator .maFile, mounted read-only (STEAM_MAFILE): its shared_secret (and account_name) are
// read once at start-up, kept in memory only, and never written or logged
function readMaFile(file) {
    if (!file) return {};
    try {
        const ma = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof ma?.shared_secret !== 'string' || !ma.shared_secret) throw new Error('it has no shared_secret (is it encrypted? export it unencrypted from SDA)');
        return { sharedSecret: ma.shared_secret, account: typeof ma.account_name === 'string' ? ma.account_name : '' };
    } catch (err) {
        // the reason only, never the file's contents
        console.error(`STEAM_MAFILE (${file}) could not be used: ${err instanceof SyntaxError ? 'it is not valid JSON (an encrypted maFile cannot be read)' : err.message}`);
        process.exit(1);
    }
}
const MA = readMaFile(env('STEAM_MAFILE'));
const ACCOUNT = env('STEAM_ACCOUNT_NAME') || MA.account || '';
const PASSWORD = process.env.STEAM_PASSWORD || '';
const SHARED_SECRET = env('STEAM_SHARED_SECRET') || MA.sharedSecret || '';
const UI_USER = env('UI_USER', 'admin');
const UI_PASSWORD = process.env.UI_PASSWORD || '';
const MAX = Math.max(1, Math.min(LANES, Math.floor(Number(env('MAX_PER_OPEN', '10'))) || 10));
const hasToken = () => fs.existsSync(path.join(DATA_DIR, 'refresh-token.txt'));
const DEMO = /^(1|true|yes|on)$/i.test(env('DEMO')) || (!ACCOUNT && !hasToken());

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!DEMO && !UI_PASSWORD && !/^(1|true|yes)$/i.test(env('ALLOW_NO_PASSWORD'))) {
    // the page can spend keys: never serve it unprotected by accident
    console.error('UI_PASSWORD is not set. The web page can open cases (and spend keys) on this account, so it needs a password.\nSet UI_PASSWORD, or DEMO=1 to try the demo without an account.');
    process.exit(1);
}

const bench = DEMO ? demoBench({ dataDir: path.join(DATA_DIR, 'demo'), max: MAX, log: (...a) => log('demo:', ...a) }) : steamBench({ dataDir: DATA_DIR, account: ACCOUNT, password: PASSWORD, sharedSecret: SHARED_SECRET, max: MAX, log });
if (DEMO) fs.mkdirSync(path.join(DATA_DIR, 'demo'), { recursive: true });
const prices = createPrices({ enabled: !/^(0|off|false|no)$/i.test(env('PRICES', 'on')), currency: env('CURRENCY', 'USD').toUpperCase(), dataDir: DATA_DIR, ttlHours: Number(env('PRICE_TTL_HOURS', '6')) || 6, log: (...a) => log(...a) });

// ---- HTTP ----
const PUBLIC = path.resolve(new URL('../public', import.meta.url).pathname);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SECURITY_HEADERS = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    // the pages load only themselves, and item icons from Steam
    'content-security-policy': "default-src 'self'; img-src 'self' data: https://media.steampowered.com https://community.cloudflare.steamstatic.com https://steamcommunity-a.akamaihd.net; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
};

function send(res, code, body, headers = {}) {
    const json = typeof body !== 'string';
    res.writeHead(code, { ...SECURITY_HEADERS, 'content-type': json ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(json ? JSON.stringify(body) : body);
}

const safeEqual = (a, b) => {
    const x = crypto.createHash('sha256').update(String(a)).digest();
    const y = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(x, y);
};
function authorised(req) {
    if (!UI_PASSWORD) return true;
    const m = /^Basic (.+)$/i.exec(req.headers.authorization || '');
    if (!m) return false;
    const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
    return safeEqual(user, UI_USER) && safeEqual(rest.join(':'), UI_PASSWORD);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', c => {
            raw += c;
            if (raw.length > 1e5) {
                reject(new Error('body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                reject(new Error('not JSON'));
            }
        });
        req.on('error', reject);
    });
}

function state() {
    const s = bench.status();
    const view = logView(bench.log.recent(100));
    return {
        ...s,
        cases: s.cases.map(c => ({ ...c, likelyKey: likelyKey(c, s.keys) })),
        entries: view.entries,
        batches: view.batches,
        samples: sampleKinds(),
        currency: prices.currency,
        venue: prices.venue,
        pricing: prices.enabled
    };
}

async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    if (req.method === 'POST') {
        // a page on another site cannot send JSON here without the browser asking first, and its origin is refused
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'send JSON' });
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'wrong origin' });
    }
    switch (route) {
        case 'GET /api/state':
            return send(res, 200, state());
        case 'GET /api/sample':
            return send(res, 200, sampleBatch(String(url.searchParams.get('kind') || 'lucky'), { count: url.searchParams.get('count'), seed: Number(url.searchParams.get('seed')) || 1 }));
        case 'POST /api/prices': {
            const body = await readBody(req);
            return send(res, 200, { currency: prices.currency, venue: prices.venue, prices: await prices.get(body.names) });
        }
        case 'POST /api/open': {
            const body = await readBody(req);
            const result = await bench.open(String(body.case || ''), String(body.key || ''), body.count);
            return send(res, 200, result);
        }
        case 'GET /api/pnl': {
            const view = logView(bench.log.recent(2000));
            const p = await prices.get(pnlNames(view), { waitMs: 15000 });
            const opts = { caseUsd: Number(url.searchParams.get('caseUsd')) || null, keyUsd: Number(url.searchParams.get('keyUsd')) || null };
            return send(res, 200, { mode: bench.mode, at: Math.floor(Date.now() / 1000), currency: prices.currency, pricing: prices.enabled, logged: view.entries.length, ...unboxPnl(view, p, opts) });
        }
        default:
            return send(res, 404, { error: 'not found' });
    }
}

function serveFile(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname === '/profit' ? 'profit.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'not found');
    fs.readFile(file, (err, buf) => {
        if (err) return send(res, 404, 'not found');
        res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
        res.end(buf);
    });
}

const server = http.createServer(async (req, res) => {
    if (!authorised(req)) return send(res, 401, 'Sign in', { 'www-authenticate': 'Basic realm="tf2-unboxer", charset="UTF-8"' });
    let url;
    try {
        url = new URL(req.url, 'http://localhost');
    } catch {
        return send(res, 400, 'bad url');
    }
    try {
        if (url.pathname.startsWith('/api/')) return await api(req, res, url);
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
        return serveFile(res, url.pathname);
    } catch (err) {
        log(`${req.method} ${url.pathname}: ${err.message}`);
        if (!res.headersSent) send(res, 400, { error: err.message });
    }
});
server.requestTimeout = 10 * 60 * 1000; // an open of ten cases waits on the game coordinator for each
server.listen(PORT, () => log(`tf2-unboxer on :${PORT} (${DEMO ? 'DEMO mode: no Steam account, nothing real is opened' : 'LIVE: opening cases spends real keys'}; at most ${MAX} at a time; prices ${prices.enabled ? `from the Steam Market in ${prices.currency}` : 'off'})`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
