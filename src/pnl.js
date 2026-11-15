// Profit and loss of the unboxing (profit.html). Each press of "Open" is a session: what went in (the case, which
// could have been sold, and the key, which had to be bought) against what came out, valued at what selling it on the
// Steam Market would pay after its fees. Prices come from prices.js when the page asks; your own figures for the case
// and the key replace them when typed. An Unusual is not valued: its price depends on its effect and hat, so it is
// counted and left out rather than guessed.

const r2 = v => Math.round(v * 100) / 100;
const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * The cost of one case opened: the case (what selling it would have paid) and the key (what buying one costs).
 * `caseUsd` / `keyUsd` (your own figures, in the page's currency) win over the market's.
 */
export function caseCost(caseName, keyName, prices, { caseUsd = null, keyUsd = null } = {}) {
    const cp = prices[caseName] || null, kp = prices[keyName] || null;
    let c = null, cFrom = null;
    if (num(caseUsd)) [c, cFrom] = [num(caseUsd), 'your figure'];
    else if (cp && num(cp.net)) [c, cFrom] = [cp.net, 'Steam Market lowest listing, after its fee (what selling it would pay)'];
    let k = null, kFrom = null;
    if (num(keyUsd)) [k, kFrom] = [num(keyUsd), 'your figure'];
    else if (kp && num(kp.price)) [k, kFrom] = [kp.price, 'Steam Market lowest listing (what buying one costs)'];
    return { caseUsd: c, caseFrom: cFrom, keyUsd: k, keyFrom: kFrom, each: c === null && k === null ? null : r2((c || 0) + (k || 0)), complete: c !== null && k !== null };
}

const blank = () => ({ cases: 0, items: 0, cost: 0, worth: 0, priced: 0, unpriced: 0, unusuals: 0, costMissing: 0 });
function add(t, s) {
    for (const k of Object.keys(t)) t[k] += s[k];
}
function finish(t) {
    t.cost = r2(t.cost);
    t.worth = r2(t.worth);
    t.profit = r2(t.worth - t.cost);
    t.perCase = t.cases ? { cost: r2(t.cost / t.cases), worth: r2(t.worth / t.cases), profit: r2((t.worth - t.cost) / t.cases) } : null;
    return t;
}

/** Sessions and the running total. `view` is logView's answer; `prices` is prices.get's answer for pnlNames(view). */
export function unboxPnl(view, prices, opts = {}) {
    const sessions = [];
    const total = blank();
    for (const b of view?.batches || []) {
        const keyName = b.entries.find(e => e.keyName)?.keyName || '';
        const cost = caseCost(b.entries[0]?.caseMarket || b.case, keyName, prices || {}, opts);
        const t = blank();
        const items = [];
        for (const e of b.entries) {
            t.cases++;
            t.cost += cost.each || 0;
            if (!cost.complete) t.costMissing++;
            for (const it of e.items) {
                t.items++;
                const p = !it.unusual && it.marketName ? (prices || {})[it.marketName] : null;
                const net = p && num(p.net) ? p.net : null;
                if (it.unusual) t.unusuals++;
                else if (net === null) t.unpriced++;
                else {
                    t.priced++;
                    t.worth += net;
                }
                items.push({ title: it.title, label: it.label, marketName: it.marketName, quality: it.quality, strange: it.strange, unusual: it.unusual, effect: it.effect, grade: it.grade, image: it.image, price: p ? p.price : null, net });
            }
        }
        add(total, t);
        sessions.push({ at: b.at, case: b.case, key: keyName, demo: b.entries.some(e => e.demo), costEach: cost, ...finish(t), list: items.sort((a, c) => (c.unusual ? 1e9 : c.net ?? -1) - (a.unusual ? 1e9 : a.net ?? -1)) });
    }
    return { sessions, total: finish(total) };
}

/** Every name the page needs a price for: the items (Unusuals left out), the cases and the keys. */
export function pnlNames(view) {
    const out = new Set();
    for (const b of view?.batches || []) {
        if (b.entries[0]?.caseMarket || b.case) out.add(b.entries[0]?.caseMarket || b.case);
        for (const e of b.entries) {
            if (e.keyName) out.add(e.keyName);
            for (const it of e.items) if (!it.unusual && it.marketName) out.add(it.marketName);
        }
    }
    return [...out];
}
