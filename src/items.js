// What the game coordinator says about an item, as plain data. Nothing here talks to Steam.
// An item in the TF2 backpack (the `tf2` library's backpack and its itemAcquired event) carries its definition index,
// quality and a list of attributes whose values are 32-bit floats in value_bytes.

const ATTR_UNUSUAL_EFFECT = 134;
const ATTR_CRATE_SERIES = 187;
const ATTR_KILL_EATER = 214; // a Strange counter: an Unusual that also counts kills is a Strange Unusual
const ATTR_KILLSTREAK_EFFECT = 2013;
const ATTR_KILLSTREAK_SHEEN = 2014;

export const QUALITY_NAMES = { 0: 'Normal', 1: 'Genuine', 3: 'Vintage', 5: 'Unusual', 6: 'Unique', 7: 'Community', 8: 'Valve', 9: 'Self-Made', 11: 'Strange', 13: 'Haunted', 14: "Collector's", 15: 'Decorated Weapon' };
const SHEENS = { 1: 'Team Shine', 2: 'Deadly Daffodil', 3: 'Manndarin', 4: 'Mean Green', 5: 'Agonizing Emerald', 6: 'Villainous Violet', 7: 'Hot Rod' };
const KILLSTREAKERS = { 2002: 'Fire Horns', 2003: 'Cerebral Discharge', 2004: 'Tornado', 2005: 'Flames', 2006: 'Singularity', 2007: 'Incinerator', 2008: 'Hypno-Beam' };

/** An item attribute's value as a float, or null when the item does not carry it. */
export function attrFloat(item, def) {
    const a = (item?.attribute || []).find(x => Number(x.def_index) === def);
    if (!a || !a.value_bytes || a.value_bytes.length < 4) return null;
    return Buffer.from(a.value_bytes).readFloatLE(0);
}

const hasAttr = (item, def) => (item?.attribute || []).some(x => Number(x.def_index) === def);

/** What came out of a crate: { id, def, quality, effect, strange, sheen, killstreaker }. */
export function describeItem(item) {
    const quality = Number(item.quality);
    const effect = attrFloat(item, ATTR_UNUSUAL_EFFECT);
    const sheen = attrFloat(item, ATTR_KILLSTREAK_SHEEN);
    const ks = attrFloat(item, ATTR_KILLSTREAK_EFFECT);
    return {
        id: String(item.id),
        def: Number(item.def_index),
        quality: QUALITY_NAMES[quality] || `quality ${item.quality}`,
        effect: quality === 5 && effect !== null ? Math.round(effect) : null,
        strange: quality === 11 || hasAttr(item, ATTR_KILL_EATER),
        sheen: sheen !== null ? SHEENS[Math.round(sheen)] || null : null,
        killstreaker: ks !== null ? KILLSTREAKERS[Math.round(ks)] || null : null
    };
}

/** A crate's series number (#127), or null for a crate that has none. */
export function crateSeries(item) {
    const v = attrFloat(item, ATTR_CRATE_SERIES);
    return v !== null && v > 0 ? Math.round(v) : null;
}

/**
 * What the backpack holds that can be opened, grouped: crates by definition index and series, keys by definition
 * index. `data` is unbox-data.json. Each group: { id, name, count, ids: [item id], def, series?, restriction?, keyDef? }.
 */
export function openables(backpack, data) {
    const crates = new Map();
    const keys = new Map();
    const nameOf = def => (data.names?.[def] ? data.names[def][0] : `Item ${def}`);
    for (const item of backpack || []) {
        const def = Number(item.def_index);
        if (data.crates?.[def]) {
            const series = crateSeries(item);
            const id = series ? `${def}:${series}` : String(def);
            if (!crates.has(id)) crates.set(id, { id, def, series, name: `${nameOf(def)}${series ? ` #${series}` : ''}`, restriction: data.crates[def].r || null, keyDef: data.crates[def].k || null, ids: [] });
            crates.get(id).ids.push(String(item.id));
        } else if (data.keys && Object.prototype.hasOwnProperty.call(data.keys, def)) {
            const id = String(def);
            if (!keys.has(id)) keys.set(id, { id, def, name: nameOf(def), restriction: data.keys[def] || null, ids: [] });
            keys.get(id).ids.push(String(item.id));
        }
    }
    const done = m => [...m.values()].map(g => ({ ...g, count: g.ids.length })).sort((a, b) => a.name.localeCompare(b.name));
    return { crates: done(crates), keys: done(keys) };
}

/** The key that most likely opens a crate group, from the keys held: the one it names, else one of the same restriction. */
export function likelyKey(crate, keys) {
    if (!crate) return null;
    if (crate.keyDef) {
        const k = keys.find(x => x.def === crate.keyDef);
        if (k) return k.id;
    }
    if (crate.restriction) {
        const k = keys.find(x => x.restriction === crate.restriction);
        if (k) return k.id;
    }
    return null;
}

/** n pairs of [key id, crate id], or { error }. */
export function pairs(crateIds, keyIds, count, max) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return { error: 'Type how many to open (a whole number, at least 1).' };
    if (n > max) return { error: `At most ${max} at a time.` };
    if (crateIds.length < n) return { error: `The account holds ${crateIds.length} of that case, not ${n}.` };
    if (keyIds.length < n) return { error: `The account holds ${keyIds.length} of that key, not ${n}.` };
    return { pairs: Array.from({ length: n }, (_, i) => [String(keyIds[i]), String(crateIds[i])]) };
}
