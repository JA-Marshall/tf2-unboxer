// The unboxing screen's data (public/unbox-show.js draws it). The game coordinator says what came out of a case as a
// definition index, a quality and an unusual effect number; this module turns that into what the screen shows: the
// item's name and case grade and the effect's name from the game's own files (data/unbox-data.json, built by
// scripts/gen-unbox-data.js), and Steam's own icon of the item, loaded from Steam by the browser.
// It only ever READS: nothing here opens a case. Sample batches for the demo are built here too, and are marked as
// samples all the way to the screen.
import fs from 'node:fs';

export const DATA = JSON.parse(fs.readFileSync(new URL('../data/unbox-data.json', import.meta.url), 'utf8'));

// the grades a case item can have, lowest first; the screen opens the lowest first and holds the best for last
const TIERS = { common: 1, uncommon: 1, rare: 1, mythical: 2, legendary: 3, ancient: 4, immortal: 4 };
const QUALITY_PREFIX = /^(Strange |Unusual |Genuine |Vintage |Haunted |Collector's |Non-Craftable |Uncraftable |The )+/;
export const LANES = 10; // cases the screen shows at once

// where Steam serves the icons its TF2 item schema names; unbox-data.json keeps the file name of each
const STEAM_ICONS = 'https://media.steampowered.com/apps/440/icons/';
/** Steam's icon of an item, by definition index, or null for an item the data file does not know. */
export function steamIcon(def) {
    const file = DATA.icons?.[def];
    return typeof file === 'string' && /^[\w.-]+\.png$/.test(file) ? STEAM_ICONS + file : null;
}

/**
 * One item out of a case, as the screen shows it. `o` is { id, def, name?, quality, effect, strange?, sheen,
 * killstreaker }.
 */
export function showItem(o) {
    const def = Number(o?.def);
    // a case item: its name and grade; anything else a crate can hold (a weapon, a Strange Part, a bonus Name Tag):
    // its name from Steam's schema
    const known = DATA.items[def] || null;
    const base = known ? [known[0], known[2]] : DATA.names?.[def] || null;
    const quality = typeof o?.quality === 'string' && o.quality ? o.quality : 'Unique';
    const steamName = typeof o?.name === 'string' && o.name ? o.name : null;
    const unusual = quality === 'Unusual';
    // an Unusual can also be Strange: the game says so with a kill counter on the item (o.strange)
    const strange = quality === 'Strange' || (unusual && (o?.strange === true || /^Strange /.test(steamName || '')));
    const tier = known ? TIERS[known[1]] || 1 : 1;
    const effectId = unusual && Number.isInteger(o.effect) && o.effect > 0 ? o.effect : null;
    const title = base ? base[0] : steamName ? steamName.replace(QUALITY_PREFIX, '') : Number.isFinite(def) ? `Item ${def}` : 'Unknown item';
    return {
        id: String(o?.id ?? ''),
        def: Number.isFinite(def) ? def : null,
        title,
        // false while all we have is a number: the screen says so instead of showing "Item 31103" as if it were a name
        named: !!(base || steamName),
        steamName,
        quality,
        strange,
        unusual,
        grade: known ? { key: known[1], name: DATA.grades[known[1]] || known[1], tier } : null,
        effect: effectId ? { id: effectId, name: DATA.effects[effectId] || null } : null,
        sheen: o?.sheen || null,
        killstreaker: o?.killstreaker || null,
        // the name the Steam Market knows it by, built the way Steam builds it
        marketName: steamName || (base ? `${unusual ? 'Unusual ' : quality !== 'Unique' ? `${quality} ` : base[1] ? 'The ' : ''}${base[0]}` : null),
        image: steamIcon(def),
        // what the item is called on a page: its quality first unless it is plain Unique ("Strange Diamondback")
        label: `${strange && unusual ? 'Strange ' : ''}${quality !== 'Unique' ? `${quality} ` : ''}${title}`,
        // the order of the reveal: grade, a Strange just after its plain grade, an Unusual after everything
        rank: unusual ? 9 : tier + (strange ? 0.5 : 0)
    };
}

/** One opened case: the log entry { at, case, key, out: [..] } with its items best first. */
export function showEntry(entry) {
    const out = Array.isArray(entry?.out) ? entry.out : [];
    const items = out.map(o => showItem(o)).sort((a, b) => b.rank - a.rank);
    return {
        key: `${Number(entry?.at) || 0}:${out.map(o => String(o?.id ?? '')).join(',') || 'none'}`,
        at: Number(entry?.at) || 0,
        case: String(entry?.case || ''),
        // the case's name on the Steam Market (a numbered crate's series is left out), for its price
        caseMarket: String(entry?.caseMarket || entry?.case || '').replace(/ #\d+$/, ''),
        keyName: String(entry?.key || ''),
        demo: entry?.demo === true,
        items
    };
}

/**
 * The log as presses: entries (oldest first) of one case name, close together, ten at most. Each case is logged on its
 * own, a few seconds apart, so a gap over `gapSec` is a new press.
 */
export function batches(entriesOldestFirst, { gapSec = 20, max = LANES } = {}) {
    const out = [];
    let cur = null;
    for (const e of entriesOldestFirst) {
        if (!cur || cur.case !== e.case || e.at - cur.entries[cur.entries.length - 1].at > gapSec || cur.entries.length >= max) {
            cur = { at: e.at, case: e.case, entries: [] };
            out.push(cur);
        }
        cur.entries.push(e);
    }
    return out;
}

/** The log (newest first) as entries and batches for the screen. */
export function logView(log) {
    const entries = (Array.isArray(log) ? log : []).map(e => showEntry(e));
    return { entries, batches: batches([...entries].reverse()).reverse() };
}

// ---- the demo: clearly marked sample batches from the Summer 2020 Cosmetic Case's own contents ----
// items_game.txt: the case's collection is definition indexes 31103-31124 (22 items) and its Unusual effects are
// 147-155 ("unusual_hat_chance_summer2020_case").
export const SAMPLE_CASE = 'Summer 2020 Cosmetic Case';
export const SAMPLE_KEY = 'Summer 2020 Cosmetic Key';
const SAMPLE_DEFS = Object.keys(DATA.items).map(Number).filter(d => d >= 31103 && d <= 31124);
const SAMPLE_EFFECTS = [147, 148, 149, 150, 151, 152, 153, 154, 155];
// one letter a case: m/c/a/e = Mercenary/Commando/Assassin/Elite, upper case = Strange, U = an Unusual
const SAMPLE_KINDS = {
    typical: { label: 'A typical ten', pattern: 'mcmmMmcmam' },
    lucky: { label: 'A lucky ten (one Unusual)', pattern: 'mcmMmaUmeC' },
    stopped: { label: 'The bot stops after six', pattern: 'mmcMmm', stopped: 'the game coordinator did not open it (sample of a stopped press)' }
};
const GRADE_OF = { m: 'rare', c: 'mythical', a: 'legendary', e: 'ancient' };

export function rng(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const sampleKinds = () => Object.entries(SAMPLE_KINDS).map(([id, k]) => ({ id, label: k.label, count: k.pattern.length }));

/** One sample item out of the Summer 2020 case: the raw shape the game coordinator gives, by a pattern letter. */
export function sampleOut(letter, pick, used, id) {
    const unusual = letter === 'U';
    const grade = unusual ? pick(['rare', 'mythical', 'legendary']) : GRADE_OF[letter.toLowerCase()];
    const pool = SAMPLE_DEFS.filter(d => DATA.items[d][1] === grade);
    const fresh = pool.filter(d => !used.has(d));
    const def = pick(fresh.length ? fresh : pool);
    used.add(def);
    const quality = unusual ? 'Unusual' : letter !== letter.toLowerCase() ? 'Strange' : 'Unique';
    return { id, def, quality, effect: unusual ? pick(SAMPLE_EFFECTS) : null, strange: quality === 'Strange' };
}

/**
 * A sample press: { sample: true, kind, label, case, requested, stopped, entries } with `count` cases (the pattern's
 * best ones are kept when fewer are asked for). The same seed gives the same items.
 */
export function sampleBatch(kind = 'lucky', { count, seed = 1 } = {}) {
    const k = SAMPLE_KINDS[kind] || SAMPLE_KINDS.lucky;
    const rand = rng(seed);
    const pick = list => list[Math.floor(rand() * list.length)];
    let letters = [...k.pattern];
    const requested = Math.max(1, Math.min(LANES, Math.floor(Number(count)) || (k.stopped ? LANES : letters.length)));
    if (!k.stopped && requested < letters.length) {
        // fewer cases: drop plain Mercenary ones first, so a short demo still shows the range
        const worth = c => (c === 'U' ? 9 : 'mcae'.indexOf(c.toLowerCase()) + (c !== c.toLowerCase() ? 0.5 : 0));
        const keep = new Set(
            letters
                .map((c, i) => [worth(c), i])
                .sort((a, b) => b[0] - a[0])
                .slice(0, requested)
                .map(x => x[1])
        );
        letters = letters.filter((_, i) => keep.has(i));
    }
    const used = new Set();
    const at = 1_600_000_000; // a fixed, obviously old time: a sample was never opened
    const entries = letters.map((c, i) => showEntry({ at: at + i * 3, case: SAMPLE_CASE, key: SAMPLE_KEY, out: [sampleOut(c, pick, used, `sample-${i + 1}`)] }));
    return { sample: true, kind: SAMPLE_KINDS[kind] ? kind : 'lucky', label: k.label, case: SAMPLE_CASE, requested: k.stopped ? Math.max(requested, entries.length) : entries.length, stopped: k.stopped || null, entries };
}
