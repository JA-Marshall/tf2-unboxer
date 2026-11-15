// The thing that opens cases. Two kinds, one shape:
//   steamBench  signs in to a Steam account you own, connects to the TF2 game coordinator, and opens n cases with n
//               keys from that account's backpack, only when asked (POST /api/open). Every open spends a key for good.
//   demoBench   needs no account: a pretend backpack of Summer 2020 Cosmetic Cases and keys, whose "opens" pick sample
//               items from that case's real contents. Every entry it logs is marked as a demo.
// Both log each opened case to DATA_DIR/unbox-log.json: { at, case, caseMarket, key, out: [items], demo? }.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describeItem, openables, pairs } from './items.js';
import { DATA, SAMPLE_CASE, SAMPLE_KEY, rng, sampleOut } from './show.js';

const require = createRequire(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function createLog(dataDir, log) {
    const file = path.join(dataDir, 'unbox-log.json');
    let entries = [];
    try {
        entries = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(entries)) entries = [];
    } catch (err) {
        if (err.code !== 'ENOENT') {
            // an unreadable log is kept aside, never overwritten
            const aside = `${file}.corrupt-${Date.now()}`;
            try {
                fs.copyFileSync(file, aside);
            } catch {
                // nothing to keep
            }
            log(`log: ${file} could not be read (${err.message}); copied to ${aside}, starting empty`);
        }
    }
    return {
        push(entry) {
            entries.push(entry);
            entries = entries.slice(-2000);
            try {
                fs.writeFileSync(`${file}.tmp`, JSON.stringify(entries));
                fs.renameSync(`${file}.tmp`, file);
            } catch (err) {
                log(`log: could not save (${err.message})`);
            }
        },
        /** the last n entries, newest first */
        recent: (n = 100) => entries.slice(-n).reverse()
    };
}

/** Pairs n crates with n keys and opens them one at a time through `openOne(keyId, crateId)` -> items | null. */
async function runOpen({ group, key, count, max, openOne, log, history, demo, gapMs, connected }) {
    const p = pairs(group.ids, key.ids, count, max);
    if (p.error) return { ok: false, message: p.error };
    log(`opening ${p.pairs.length} x ${group.name} with ${key.name}${demo ? ' (demo)' : ''}`);
    const opened = [];
    let stopped = null;
    for (const [keyId, crateId] of p.pairs) {
        if (!connected()) {
            stopped = 'lost the game coordinator';
            break;
        }
        const out = await openOne(keyId, crateId);
        if (!out) {
            stopped = 'the game coordinator did not open it (wrong key for this case, or no answer)';
            break;
        }
        const entry = { at: Math.floor(Date.now() / 1000), case: group.name, caseMarket: group.name.replace(/ #\d+$/, ''), key: key.name, out, ...(demo ? { demo: true } : {}) };
        history.push(entry);
        opened.push(entry);
        log(`opened ${group.name}: ${JSON.stringify(out)}`);
        await sleep(gapMs);
    }
    const n = opened.length;
    return { ok: n > 0, message: `Opened ${n} of ${p.pairs.length}.${stopped ? ` Stopped: ${stopped}.` : ''}`, opened };
}

function exclusiveRunner(log) {
    let busy = null;
    return {
        busy: () => busy,
        async run(what, fn) {
            if (busy) return { ok: false, message: `Busy (${busy}). Try again in a moment.` };
            busy = what;
            try {
                return await fn();
            } catch (err) {
                log(`${what} failed: ${err.message}`);
                return { ok: false, message: err.message };
            } finally {
                busy = null;
            }
        }
    };
}

export function demoBench({ dataDir, max = 10, log = console.log, gapMs = 2200 } = {}) {
    const history = createLog(dataDir, log);
    const runner = exclusiveRunner(log);
    // the pretend backpack: refilled when it runs low, so the demo never runs dry
    let stock = 0;
    const caseDef = Number(Object.entries(DATA.names).find(([, v]) => v[0] === SAMPLE_CASE)?.[0]) || 5914;
    const keyDef = Number(Object.entries(DATA.names).find(([, v]) => v[0] === SAMPLE_KEY)?.[0]) || 5913;
    const fill = () => {
        if (stock < 10) stock = 50;
    };
    const groups = () => {
        fill();
        const ids = Array.from({ length: stock }, (_, i) => `demo-${i}`);
        return {
            crates: [{ id: String(caseDef), def: caseDef, name: SAMPLE_CASE, count: stock, ids, keyDef }],
            keys: [{ id: String(keyDef), def: keyDef, name: SAMPLE_KEY, count: stock, ids }]
        };
    };
    const rand = rng(Date.now() % 1e9);
    const pick = list => list[Math.floor(rand() * list.length)];
    // roughly the odds of a cosmetic case: mostly Mercenary, now and then better, a Strange one in ten, an Unusual rare
    const letter = () => {
        const r = rand();
        const c = r < 0.012 ? 'U' : r < 0.04 ? 'e' : r < 0.2 ? 'a' : r < 0.45 ? 'c' : 'm';
        return c !== 'U' && rand() < 0.1 ? c.toUpperCase() : c;
    };
    return {
        mode: 'demo',
        status: () => ({ mode: 'demo', name: 'Demo account', online: true, gc: true, busy: runner.busy(), max, ...strip(groups()), lastError: null }),
        log: history,
        open(caseId, keyId, count) {
            return runner.run('opening', async () => {
                const g = groups();
                const group = g.crates.find(c => c.id === String(caseId));
                const key = g.keys.find(k => k.id === String(keyId));
                if (!group || !key) return { ok: false, message: 'Pick a case and a key.' };
                let n = 0;
                const used = new Set();
                const res = await runOpen({ group, key, count, max, log, history, demo: true, gapMs: 0, connected: () => true, openOne: async () => { await sleep(gapMs); n++; stock--; return [sampleOut(letter(), pick, used, `demo-${Date.now()}-${n}`)]; } });
                return res;
            });
        }
    };
}

const strip = g => ({ cases: g.crates.map(({ ids, ...c }) => c), keys: g.keys.map(({ ids, ...k }) => k) });

export function steamBench({ dataDir, account, password, sharedSecret, max = 10, gapMs = 1500, answerMs = 30000, log = console.log }) {
    const SteamUser = require('steam-user');
    const SteamTotp = require('steam-totp');
    const TF2 = require('tf2');
    const history = createLog(dataDir, log);
    const runner = exclusiveRunner(log);
    const tokenFile = path.join(dataDir, 'refresh-token.txt');
    let lastError = null;

    // ---- signing in: a saved refresh token first (no Steam Guard code needed), else the password and a code ----
    const client = new SteamUser({ autoRelogin: true, renewRefreshTokens: true });
    const tf2 = new TF2(client);
    let usedToken = false;
    function logOn() {
        let token = null;
        try {
            token = fs.readFileSync(tokenFile, 'utf8').trim();
        } catch {
            // first sign-in
        }
        if (token) {
            usedToken = true;
            log('signing in to Steam with the saved login token');
            return client.logOn({ refreshToken: token });
        }
        usedToken = false;
        if (!account || !password) {
            lastError = 'STEAM_ACCOUNT_NAME and STEAM_PASSWORD are not set';
            log(lastError);
            return;
        }
        log(`signing in to Steam as ${account}`);
        // with a shared secret the Steam Guard code is made here; without one, steam-user asks for it on the console
        client.logOn({ accountName: account, password, ...(sharedSecret ? { twoFactorCode: SteamTotp.generateAuthCode(sharedSecret) } : {}) });
    }
    client.on('refreshToken', token => {
        try {
            fs.writeFileSync(tokenFile, token, { mode: 0o600 });
        } catch (err) {
            log(`could not save the login token (${err.message})`);
        }
    });
    client.on('loggedOn', () => {
        lastError = null;
        log('signed in to Steam');
        client.setPersona(SteamUser.EPersonaState.Online);
        client.gamesPlayed([440]); // the game coordinator only talks to an account that is "in" TF2
    });
    client.on('error', err => {
        lastError = `Steam: ${err.message}`;
        log(`Steam error: ${err.message}${err.eresult !== undefined ? ` (eresult ${err.eresult})` : ''}`);
        if (usedToken) {
            // the saved token was refused (expired or revoked): forget it and sign in with the password once
            try {
                fs.unlinkSync(tokenFile);
            } catch {
                // already gone
            }
            setTimeout(logOn, 5000);
        } else if (/LoggedInElsewhere/i.test(err.message)) {
            log('this account was signed in somewhere else (playing TF2 on it?); trying again in 2 minutes');
            setTimeout(logOn, 120000);
        } else if (/RateLimit|Throttle/i.test(err.message)) {
            log('Steam is limiting sign-ins for this account or IP; trying again in 30 minutes');
            setTimeout(logOn, 30 * 60000);
        } else if (!/InvalidPassword|TwoFactor|AuthCode|AccountLogonDenied|InvalidLoginAuthCode/i.test(err.message)) {
            // a network or Steam outage: try again in a minute (a wrong password or code is not retried)
            setTimeout(logOn, 60000);
        }
    });
    client.on('playingState', blocked => {
        if (blocked) log('TF2 is running on this account somewhere else: the game coordinator will not talk to us until it closes');
    });
    tf2.on('connectedToGC', () => log('connected to the TF2 game coordinator'));
    tf2.on('disconnectedFromGC', reason => log(`lost the TF2 game coordinator (${reason})`));
    tf2.on('backpackLoaded', () => log(`backpack loaded, ${tf2.backpack.length} items`));
    logOn();

    const ready = () => !!tf2.haveGCSession && Array.isArray(tf2.backpack);

    /** Opens one crate and waits until it leaves the backpack, then a moment more for what arrives. */
    function openOne(keyId, crateId) {
        return new Promise(resolve => {
            const acquired = [];
            let removed = false;
            let timer = null;
            const finish = () => {
                clearTimeout(timer);
                tf2.removeListener('itemAcquired', onAcquired);
                tf2.removeListener('itemRemoved', onRemoved);
                // the key goes too; only what arrived is the case's contents
                resolve(removed ? acquired.map(describeItem) : null);
            };
            const onAcquired = item => acquired.push(item);
            const onRemoved = item => {
                if (!item || String(item.id) !== String(crateId) || removed) return;
                removed = true;
                clearTimeout(timer);
                timer = setTimeout(finish, 1500);
            };
            tf2.on('itemAcquired', onAcquired);
            tf2.on('itemRemoved', onRemoved);
            timer = setTimeout(finish, answerMs);
            tf2.openCrate(keyId, crateId);
        });
    }

    return {
        mode: 'live',
        status() {
            const g = ready() ? openables(tf2.backpack, DATA) : { crates: [], keys: [] };
            return { mode: 'live', name: client.accountInfo?.name || null, online: !!client.steamID, gc: !!tf2.haveGCSession, busy: runner.busy(), max, ...strip(g), lastError };
        },
        log: history,
        open(caseId, keyId, count) {
            return runner.run('opening', async () => {
                if (!ready()) return { ok: false, message: 'Not connected to the TF2 game coordinator yet.' };
                const g = openables(tf2.backpack, DATA);
                const group = g.crates.find(c => c.id === String(caseId));
                const key = g.keys.find(k => k.id === String(keyId));
                if (!group) return { ok: false, message: 'That case is not in the backpack.' };
                if (!key) return { ok: false, message: 'That key is not in the backpack.' };
                return runOpen({ group, key, count, max, log, history, demo: false, gapMs, connected: () => !!tf2.haveGCSession, openOne });
            });
        }
    };
}
