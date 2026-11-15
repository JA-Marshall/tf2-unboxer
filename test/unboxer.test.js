import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, steamNet, createPrices } from '../src/prices.js';
import { describeItem, openables, likelyKey, pairs } from '../src/items.js';
import { showItem, sampleBatch, logView } from '../src/show.js';
import { unboxPnl, pnlNames, caseCost } from '../src/pnl.js';
import { DATA } from '../src/show.js';

const float = v => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v, 0);
    return b;
};

test('parseMoney reads the formats the Steam Market answers in', () => {
    assert.equal(parseMoney('$1.23'), 1.23);
    assert.equal(parseMoney('£0,98'), 0.98);
    assert.equal(parseMoney('1.234,56€'), 1234.56);
    assert.equal(parseMoney('$1,234.56'), 1234.56);
    assert.equal(parseMoney('CDN$ 2.10'), 2.1);
    assert.equal(parseMoney(''), null);
    assert.equal(parseMoney(undefined), null);
});

test('steamNet takes off the 5% and 10% fees, a cent each at least', () => {
    assert.equal(steamNet(0.03), 0.01);
    assert.equal(steamNet(2.3), 2.0);
    assert.equal(steamNet(1.15), 1.0);
    assert.equal(steamNet(0), null);
});

test('describeItem reads quality, effect, a Strange counter and killstreak attributes', () => {
    const it = describeItem({ id: '42', def_index: 31110, quality: 5, attribute: [{ def_index: 134, value_bytes: float(150) }, { def_index: 214, value_bytes: float(0) }] });
    assert.deepEqual(it, { id: '42', def: 31110, quality: 'Unusual', effect: 150, strange: true, sheen: null, killstreaker: null });
    assert.equal(describeItem({ id: '1', def_index: 31110, quality: 6, attribute: [] }).strange, false);
});

test('openables groups crates by series and keys by kind, and the case names its key', () => {
    const bp = [
        { id: 1, def_index: 5914, attribute: [] },
        { id: 2, def_index: 5914, attribute: [] },
        { id: 3, def_index: 5022, attribute: [{ def_index: 187, value_bytes: float(82) }] },
        { id: 4, def_index: 5913, attribute: [] },
        { id: 5, def_index: 5021, attribute: [] },
        { id: 6, def_index: 31110, attribute: [] }
    ];
    const g = openables(bp, DATA);
    assert.deepEqual(g.crates.map(c => [c.id, c.count]), [['5022:82', 1], ['5914', 2]]);
    assert.ok(g.crates.find(c => c.id === '5022:82').name.endsWith('#82'));
    assert.deepEqual(g.keys.map(k => k.id).sort(), ['5021', '5913']);
    assert.equal(likelyKey(g.crates.find(c => c.id === '5914'), g.keys), '5913');
    assert.equal(likelyKey(g.crates.find(c => c.id === '5022:82'), g.keys), '5021');
});

test('pairs refuses more than held or than the cap', () => {
    assert.match(pairs(['a'], ['k'], 2, 10).error, /holds 1 of that case/);
    assert.match(pairs(['a', 'b'], ['k'], 2, 10).error, /holds 1 of that key/);
    assert.match(pairs(['a'], ['k'], 11, 10).error, /At most 10/);
    assert.deepEqual(pairs(['a', 'b'], ['k', 'l'], 2, 10).pairs, [['k', 'a'], ['l', 'b']]);
});

test('showItem names, grades and orders a case item; a Strange Unusual stays both', () => {
    const plain = showItem({ id: '1', def: 31110, quality: 'Unique' });
    assert.ok(plain.named && plain.grade && plain.image.startsWith('https://media.steampowered.com/apps/440/icons/'));
    const su = showItem({ id: '2', def: 31110, quality: 'Unusual', effect: 150, strange: true });
    assert.equal(su.strange, true);
    assert.equal(su.unusual, true);
    assert.equal(su.rank, 9);
    assert.ok(su.label.startsWith('Strange Unusual '));
});

test('the demo batch is marked as a sample and has the asked number of cases', () => {
    const b = sampleBatch('lucky', { count: 4, seed: 7 });
    assert.equal(b.sample, true);
    assert.equal(b.entries.length, 4);
    assert.ok(b.entries.some(e => e.items[0].unusual), 'a short lucky demo keeps its Unusual');
    assert.deepEqual(sampleBatch('lucky', { seed: 7 }), sampleBatch('lucky', { seed: 7 }));
});

test('profit: cost is the case sold plus the key bought; Unusuals are counted, never valued', () => {
    const log = [
        { at: 1000, case: 'Summer 2020 Cosmetic Case', caseMarket: 'Summer 2020 Cosmetic Case', key: 'Summer 2020 Cosmetic Key', out: [{ id: 'a', def: 31110, quality: 'Unique' }] },
        { at: 1003, case: 'Summer 2020 Cosmetic Case', caseMarket: 'Summer 2020 Cosmetic Case', key: 'Summer 2020 Cosmetic Key', out: [{ id: 'b', def: 31111, quality: 'Unusual', effect: 150 }] }
    ].reverse();
    const view = logView(log);
    const names = pnlNames(view);
    assert.ok(names.includes('Summer 2020 Cosmetic Case') && names.includes('Summer 2020 Cosmetic Key'));
    const item = view.entries.find(e => e.items[0].quality === 'Unique').items[0];
    const prices = { 'Summer 2020 Cosmetic Case': { price: 0.1, net: 0.08 }, 'Summer 2020 Cosmetic Key': { price: 2.5, net: 2.17 }, [item.marketName]: { price: 0.5, net: 0.43 } };
    const p = unboxPnl(view, prices);
    assert.equal(p.sessions.length, 1);
    assert.equal(p.total.cases, 2);
    assert.equal(p.total.cost, 5.16);
    assert.equal(p.total.worth, 0.43);
    assert.equal(p.total.unusuals, 1);
    assert.equal(p.total.profit, -4.73);
    assert.equal(caseCost('x', 'y', {}, { caseUsd: 0.2, keyUsd: 2 }).each, 2.2);
});

test('prices: asked one at a time, cached, "The" dropped when the full name is not listed, Unusuals never asked', async () => {
    const asked = [];
    const fetchImpl = async url => {
        const name = decodeURIComponent(new URL(url).searchParams.get('market_hash_name'));
        asked.push(name);
        const listed = { 'Mann Co. Supply Crate Key': '$2.49', 'Jarmaments': '$0.40' };
        return { ok: true, status: 200, json: async () => (listed[name] ? { success: true, lowest_price: listed[name] } : { success: false }) };
    };
    const dir = (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/unboxer-');
    const p = createPrices({ dataDir: dir, gapMs: 1, fetchImpl });
    const got = await p.get(['Mann Co. Supply Crate Key', 'The Jarmaments', 'Unusual Jarmaments']);
    assert.deepEqual(got['Mann Co. Supply Crate Key'], { price: 2.49, net: 2.18 });
    assert.equal(got['The Jarmaments'].price, 0.4);
    assert.ok(!asked.includes('Unusual Jarmaments'));
    const before = asked.length;
    await p.get(['Mann Co. Supply Crate Key']);
    assert.equal(asked.length, before, 'cached');
    assert.deepEqual(await createPrices({ enabled: false, dataDir: dir }).get(['x']), {});
});
