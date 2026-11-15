// Builds data/unbox-data.json for the unboxer (src/show.js): what the game itself says about a case's contents, so a
// result from the game coordinator (a definition index, a quality and an unusual effect number) can be named and graded
// the moment it arrives.
//   effects  unusual effect number -> English name                       ("147" -> "Verdatica")
//   grades   the case grades (rare .. ancient) -> English name, in order ("rare" -> "Mercenary")
//   items    definition index -> [English name, grade, proper name?]     (every item in a case collection)
//   names    definition index -> [English name, proper name?] for EVERY item in Steam's schema: a crate can hold more
//            than its collection (a weapon, a Strange Part, a bonus Name Tag), and each still needs a name
//   icons    definition index -> file name of Steam's own icon of the item ("sum20_breach_and_bomb_large.<hash>.png"),
//            for every item in the schema
//   crates   definition index -> { r: tool restriction, k: decoded by definition index } for every crate and case
//   keys     definition index -> tool restriction (or null) for every key
// Source: SteamDatabase/GameTracking-TF2 (tf/scripts/items/items_game.txt and tf/resource/tf_english.txt), the same
// source as bot/craft-pool.json. The icons are the ones Steam's item schema names for each item (GetSchemaItems,
// image_url_large, served by Steam at media.steampowered.com/apps/440/icons/); the game's files carry no web address
// for them, so the schema is read from its public copy in danocmx/node-tf2-static-schema (static/items.json), which
// needs no Steam API key. Refresh after a TF2 update that adds a case:
//   node scripts/gen-unbox-data.js            (downloads the three files)
//   node scripts/gen-unbox-data.js items_game.txt tf_english.txt schema-items.json
import fs from 'node:fs';

const RAW = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-TF2/master/';
const SCHEMA = 'https://raw.githubusercontent.com/danocmx/node-tf2-static-schema/master/static/items.json';
// the only place an icon may come from: Steam's own icon folder for TF2. Only the file name is kept.
const ICON = /^https?:\/\/media\.steampowered\.com\/apps\/440\/icons\/([\w.-]+\.png)$/i;
const GRADES = ['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient', 'immortal'];

/** Valve KeyValues text -> nested objects. A key that repeats keeps its last value (nothing read here repeats). */
export function parseKeyValues(text) {
    let i = 0;
    const n = text.length;
    const token = () => {
        for (;;) {
            while (i < n && /\s/.test(text[i])) i++;
            if (text[i] === '/' && text[i + 1] === '/') {
                while (i < n && text[i] !== '\n') i++;
                continue;
            }
            break;
        }
        if (i >= n) return null;
        const c = text[i];
        if (c === '{' || c === '}') {
            i++;
            return c;
        }
        if (c === '"') {
            let out = '';
            i++;
            while (i < n && text[i] !== '"') {
                if (text[i] === '\\' && i + 1 < n) {
                    i++;
                    out += text[i] === 'n' ? '\n' : text[i] === 't' ? '\t' : text[i];
                } else out += text[i];
                i++;
            }
            i++;
            return { s: out };
        }
        let out = '';
        while (i < n && !/[\s{}"]/.test(text[i])) out += text[i++];
        return { s: out };
    };
    const object = () => {
        const out = {};
        for (;;) {
            const k = token();
            if (k === null || k === '}') return out;
            if (k === '{') throw new Error('KeyValues: a block with no name');
            const v = token();
            if (v === '{') out[k.s] = object();
            else if (v && v.s !== undefined) out[k.s] = v.s;
            else throw new Error(`KeyValues: "${k.s}" has no value`);
        }
    };
    return object();
}

/** tf_english.txt -> Map(lower-case token -> English). */
export function parseStrings(text) {
    const tokens = parseKeyValues(text.replace(/^﻿/, '')).lang?.Tokens || {};
    const out = new Map();
    for (const [k, v] of Object.entries(tokens)) if (typeof v === 'string' && !k.startsWith('[english]')) out.set(k.toLowerCase(), v);
    return out;
}

/**
 * @param {string} itemsGameText  items_game.txt
 * @param {string} englishText    tf_english.txt
 * @param {Array<{ defindex: number, image_url?: string, image_url_large?: string }>} [schemaItems]  Steam's item schema
 */
export function build(itemsGameText, englishText, schemaItems = []) {
    const game = parseKeyValues(itemsGameText).items_game;
    const en = parseStrings(englishText);
    const say = token => (typeof token === 'string' ? en.get(token.replace(/^#/, '').toLowerCase()) || null : null);

    const effects = {};
    for (const group of Object.values(game.attribute_controlled_attached_particles || {}))
        for (const id of Object.keys(group)) {
            const name = say(`Attrib_Particle${id}`);
            if (name && /^\d+$/.test(id)) effects[id] = name;
        }

    const grades = {};
    for (const key of GRADES) {
        const name = say(game.rarities?.[key]?.loc_key);
        if (name) grades[key] = name;
    }

    // an item's own keys, then its prefabs' (a prefab line may name several)
    const prefabs = game.prefabs || {};
    const field = (item, key, depth = 0) => {
        if (item[key] !== undefined) return item[key];
        if (depth > 6 || typeof item.prefab !== 'string') return undefined;
        for (const p of item.prefab.split(/\s+/)) {
            const v = prefabs[p] ? field(prefabs[p], key, depth + 1) : undefined;
            if (v !== undefined) return v;
        }
        return undefined;
    };
    const byName = new Map();
    for (const [def, item] of Object.entries(game.items || {})) if (/^\d+$/.test(def) && typeof item === 'object' && item.name) byName.set(item.name, { def, item });

    const items = {};
    for (const collection of Object.values(game.item_collections || {}))
        for (const [grade, list] of Object.entries(collection.items || {})) {
            if (!GRADES.includes(grade) || typeof list !== 'object') continue;
            for (const internal of Object.keys(list)) {
                const found = byName.get(internal);
                if (!found) continue; // war paints and the like: not an item of their own
                const name = say(field(found.item, 'item_name'));
                if (!name) continue;
                items[found.def] = field(found.item, 'propername') === '1' ? [name, grade, 1] : [name, grade];
            }
        }
    // every item's name and Steam's icon of it (the large one, else the small one): a crate can hold things outside its
    // collection (a weapon, a Strange Part), which still need a name
    const names = {}, icons = {}, crates = {}, keys = {};
    for (const it of Array.isArray(schemaItems) ? schemaItems : []) {
        if (!it || !Number.isInteger(it.defindex) || typeof it.item_name !== 'string' || !it.item_name) continue;
        names[it.defindex] = it.proper_name ? [it.item_name, 1] : [it.item_name];
        const m = ICON.exec(String(it.image_url_large || '')) || ICON.exec(String(it.image_url || ''));
        if (m) icons[it.defindex] = m[1];
        const restriction = typeof it.tool?.restriction === 'string' && it.tool.restriction ? it.tool.restriction : null;
        if (it.item_class === 'supply_crate') {
            const by = (it.attributes || []).find(a => a && a.class === 'decoded_by_itemdefindex');
            crates[it.defindex] = { r: restriction, k: by && Number.isInteger(Number(by.value)) ? Number(by.value) : null };
        } else if (it.tool?.type === 'decoder_ring') keys[it.defindex] = restriction;
    }
    return { effects, grades, items, names, icons, crates, keys };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const read = async (arg, remote) => (arg ? fs.readFileSync(arg, 'utf8') : (await fetch(RAW + remote)).text());
    const schema = JSON.parse(process.argv[4] ? fs.readFileSync(process.argv[4], 'utf8') : await (await fetch(SCHEMA)).text());
    const data = build(await read(process.argv[2], 'tf/scripts/items/items_game.txt'), await read(process.argv[3], 'tf/resource/tf_english.txt'), schema);
    const out = {
        _comment: 'Generated by scripts/gen-unbox-data.js from SteamDatabase/GameTracking-TF2 (items_game.txt, tf_english.txt) and Steam\'s public item schema (names, icon file names, crates and keys). Do not edit by hand.',
        generated: new Date().toISOString().slice(0, 10),
        ...data
    };
    const file = new URL('../data/unbox-data.json', import.meta.url);
    fs.writeFileSync(file, JSON.stringify(out) + '\n');
    console.log(`${Object.keys(data.effects).length} effects, ${Object.keys(data.items).length} case items, ${Object.keys(data.crates).length} crates, ${Object.keys(data.keys).length} keys, ${Object.keys(data.names).length} items named (${Object.keys(data.icons).length} with Steam's icon), grades ${Object.values(data.grades).join(' / ')} -> ${file.pathname}`);
}
