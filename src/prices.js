// Prices, optional (PRICES=off turns them off). The only source is the Steam Community Market's public price overview
// (no API key, no account): the lowest listing of an item, by its market name. Steam limits how often that page may be
// asked, so names are asked one at a time a few seconds apart, and each answer is kept for PRICE_TTL_HOURS in memory and
// in DATA_DIR/prices.json. An Unusual is never priced: its price depends on its effect, which the overview does not know.
import fs from 'node:fs';
import path from 'node:path';

// Steam's currency numbers for the overview, and the ISO code the pages format with
export const CURRENCIES = { USD: 1, GBP: 2, EUR: 3, CHF: 4, RUB: 5, PLN: 6, BRL: 7, JPY: 8, NOK: 9, IDR: 10, MYR: 11, PHP: 12, SGD: 13, THB: 14, VND: 15, KRW: 16, TRY: 17, UAH: 18, MXN: 19, CAD: 20, AUD: 21, NZD: 22 };

/** "$1.23", "£0,98", "1.234,56€", "CDN$ 2.10" -> 1.23 / 0.98 / 1234.56 / 2.1, or null. */
export function parseMoney(s) {
    if (typeof s !== 'string') return null;
    let t = s.replace(/[^\d.,]/g, '');
    if (!t) return null;
    const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        const dec = lastDot > lastComma ? '.' : ',';
        t = t.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else if (lastComma >= 0) {
        // "0,98" is a decimal comma; "1,234" a thousands one
        t = /,\d{1,2}$/.test(t) ? t.replace(/,/g, '.') : t.replace(/,/g, '');
    } else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\.(?=.*\.)/g, '');
    const v = Number(t);
    return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * What a Steam Market sale at `price` pays the seller: the buyer's price less Steam's 5% fee and TF2's 10% fee, each at
 * least one cent, in whole cents.
 */
export function steamNet(price) {
    const p = Math.round(Number(price) * 100);
    if (!(p > 0)) return null;
    const fees = r => Math.max(1, Math.floor(r * 0.05)) + Math.max(1, Math.floor(r * 0.1));
    for (let r = Math.ceil(p / 1.15) + 2; r > 0; r--) if (r + fees(r) <= p) return r / 100;
    return 0;
}

export function createPrices({ enabled = true, currency = 'USD', dataDir = '/data', ttlHours = 6, gapMs = 3500, log = () => {}, fetchImpl = globalThis.fetch } = {}) {
    const code = CURRENCIES[currency] ? currency : 'USD';
    const file = path.join(dataDir, 'prices.json');
    let cache = {}; // name -> { price, at } (price null: not listed)
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved && saved.currency === code && saved.items) cache = saved.items;
    } catch {
        // no saved prices yet
    }
    let saveTimer = null;
    const save = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                fs.writeFileSync(file, JSON.stringify({ currency: code, items: cache }));
            } catch (err) {
                log(`prices: could not save (${err.message})`);
            }
        }, 2000);
    };
    const fresh = name => cache[name] && Date.now() - cache[name].at < ttlHours * 3600_000;

    // one request at a time, gapMs apart; a 429 backs off for a minute
    const queue = [];
    const waiting = new Map(); // name -> promise
    let running = false;
    let pauseUntil = 0;
    async function pump() {
        if (running) return;
        running = true;
        while (queue.length) {
            const wait = Math.max(0, pauseUntil - Date.now());
            if (wait) await new Promise(r => setTimeout(r, wait));
            const { name, resolve } = queue.shift();
            try {
                const url = `https://steamcommunity.com/market/priceoverview/?appid=440&currency=${CURRENCIES[code]}&market_hash_name=${encodeURIComponent(name)}`;
                const r = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
                if (r.status === 429) {
                    pauseUntil = Date.now() + 60_000;
                    log('prices: the Steam Market asked us to slow down; waiting a minute');
                    queue.unshift({ name, resolve });
                    continue;
                }
                const body = r.ok ? await r.json().catch(() => null) : null;
                // a name the market does not list answers success: false (or no lowest_price)
                cache[name] = { price: body && body.success ? parseMoney(body.lowest_price) : null, at: Date.now() };
                save();
            } catch (err) {
                log(`prices: ${name}: ${err.message}`);
            }
            waiting.delete(name);
            resolve();
            await new Promise(r => setTimeout(r, gapMs));
        }
        running = false;
    }
    function ask(name) {
        if (waiting.has(name)) return waiting.get(name);
        const p = new Promise(resolve => queue.push({ name, resolve }));
        waiting.set(name, p);
        pump();
        return p;
    }

    const answer = name => {
        const c = cache[name];
        return c && c.price ? { price: c.price, net: steamNet(c.price) } : null;
    };

    return {
        enabled,
        currency: code,
        venue: { short: 'steam', long: 'the Steam Market' },
        /**
         * Prices of the names asked, as { [name]: { price, net } }; waits at most `waitMs` for names not asked before
         * (the rest keep being read in the background and are there next time).
         */
        async get(names, { waitMs = 20000 } = {}) {
            if (!enabled) return {};
            const wanted = [...new Set((Array.isArray(names) ? names : []).filter(n => typeof n === 'string' && n.length > 0 && n.length <= 120 && !/^(Strange )?Unusual /.test(n)))].slice(0, 200);
            // an item whose name starts with "The" may be listed without it: asked under that name too when the first
            // answer was "not listed"
            const bare = n => n.replace(/^((?:Strange |Genuine |Vintage |Haunted |Collector's )?)The /, '$1');
            const ask2 = async n => {
                if (!fresh(n)) await ask(n);
                if (!answer(n) && bare(n) !== n && !fresh(bare(n))) await ask(bare(n));
            };
            const missing = wanted.filter(n => !fresh(n) || (!answer(n) && bare(n) !== n && !fresh(bare(n))));
            if (missing.length) await Promise.race([Promise.all(missing.map(ask2)), new Promise(r => setTimeout(r, waitMs))]);
            const out = {};
            for (const n of wanted) {
                const a = answer(n) || answer(bare(n));
                if (a) out[n] = a;
            }
            return out;
        }
    };
}
