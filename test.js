'use strict';
// Ishga tushirish: npm test   (hech qanday tashqi paket kerak emas)
process.env.TZ_OFFSET_HOURS = '5';
const assert = require('assert');
const H = require('./helpers');
const { createStore } = require('./store');

// ---------- helpers ----------
// 2026-10-18 11:00 Toshkent vaqti (= 06:00 UTC), yakshanba
const NOW = Date.UTC(2026, 9, 18, 6, 0);

let r = H.parseDeadline('25.10 18:00 hisobot topshirish', NOW);
assert.strictEqual(r.at, Date.UTC(2026, 9, 25, 13, 0));
assert.strictEqual(r.rest, 'hisobot topshirish');

r = H.parseDeadline('ertaga 12:00 x', NOW);
assert.strictEqual(r.at, Date.UTC(2026, 9, 19, 7, 0));

r = H.parseDeadline('25.10 matn', NOW); // vaqt yozilmasa 18:00
assert.strictEqual(r.at, Date.UTC(2026, 9, 25, 13, 0));
assert.strictEqual(r.rest, 'matn');

r = H.parseDeadline('25.10.26 12:00 abc', NOW);
assert.strictEqual(r.at, Date.UTC(2026, 9, 25, 7, 0));

assert.strictEqual(H.parseDeadline('17.10 10:00 x', NOW).error, 'past');
assert.strictEqual(H.parseDeadline('31.02 x', NOW).error, 'invalid');
assert.strictEqual(H.parseDeadline('25.10 25:00 x', NOW).error, 'invalid');
assert.strictEqual(H.parseDeadline('oddiy matn 25.10', NOW), null);
assert.strictEqual(H.parseDeadline('', NOW), null);
assert.strictEqual(H.fmt(Date.UTC(2026, 9, 25, 13, 0)), '25.10.2026 18:00');
assert.strictEqual(H.dateKey(NOW), '2026-10-18');
assert.strictEqual(H.tzParts(NOW).dow, 0);
assert.strictEqual(H.periodStart('hafta', NOW).since, NOW - 7 * H.DAY);
assert.strictEqual(H.periodStart('xxx', NOW), null);

const tasks = [
    { status: 'open', users: { a: { name: 'A', status: 'bajarildi' }, b: { name: 'B', status: 'tanishdi', late: true }, c: { name: 'C', status: 'tanishmadi' }, d: { name: 'D', status: 'tanishmadi', excused: true } } },
    { status: 'closed', users: { a: { name: 'A', status: 'bajarildi', late: true }, b: { name: 'B', status: 'tanishmadi' } } },
];
const rows = H.computeStats(tasks);
const A = rows.find((x) => x.key === 'a');
const B = rows.find((x) => x.key === 'b');
const C = rows.find((x) => x.key === 'c');
const D = rows.find((x) => x.key === 'd');
assert.deepStrictEqual([A.total, A.onTime, A.late, A.rate], [2, 1, 1, 1]);
assert.deepStrictEqual([B.missed, B.pending], [2, 0]);
assert.deepStrictEqual([C.pending, C.missed], [1, 0]);
assert.deepStrictEqual([D.excused, D.rate], [1, 0]);
assert.strictEqual(rows[0].key, 'a');

// parseTargets
let tg = H.parseTargets('@Ali, @elbek_j #tuman1 25.10 matn');
assert.deepStrictEqual(tg.handles, ['ali', 'elbek_j']);
assert.deepStrictEqual(tg.tags, ['tuman1']);
assert.strictEqual(tg.rest, '25.10 matn');
tg = H.parseTargets('oddiy matn @ali');
assert.deepStrictEqual([tg.handles.length, tg.tags.length, tg.rest], [0, 0, 'oddiy matn @ali']);
tg = H.parseTargets('#туман1 @али матн');
assert.deepStrictEqual([tg.tags[0], tg.handles[0], tg.rest], ['туман1', 'али', 'матн']);
tg = H.parseTargets('@ali.ga xabar');
assert.strictEqual(tg.handles.length, 0);

// ---------- store (soxta MongoDB) ----------
function fakeMongo(preload = {}) {
    const data = {};
    const stats = { replace: 0, del: 0 };
    const get = (n) => (data[n] = data[n] || new Map());
    Object.entries(preload).forEach(([n, docs]) => docs.forEach((d) => get(n).set(d._id, d)));
    return {
        data,
        stats,
        collection(name) {
            const c = get(name);
            return {
                findOne: async (f) => c.get(f._id) || null,
                find: () => ({ toArray: async () => [...c.values()] }),
                replaceOne: async (f, doc) => { c.set(f._id, doc); },
                bulkWrite: async (ops) => {
                    for (const op of ops) {
                        if (op.replaceOne) { c.set(op.replaceOne.filter._id, op.replaceOne.replacement); stats.replace++; }
                        if (op.deleteOne) { c.delete(op.deleteOne.filter._id); stats.del++; }
                    }
                },
            };
        },
    };
}

(async () => {
    // 1) Eski bitta-hujjatli bazadan ko'chirish
    const mdb = fakeMongo({
        state: [{ _id: 'main', counter: 7, tasks: { '1_5': { sid: 1, text: 'eski' } }, stats: { ali: { name: 'Ali', score: 3, completed: 1 } }, screenshots: {}, userChatIds: {}, members: {}, ignored: {} }],
    });
    const s1 = createStore('/tmp/_unused.json');
    await s1.load(mdb);
    assert.strictEqual(s1.db.counter, 7);
    assert.strictEqual(s1.db.tasks['1_5'].text, 'eski');
    await s1.flushNow();
    assert.strictEqual(mdb.data.tasks.get('1_5').v.text, 'eski');
    assert.strictEqual(mdb.data.stats.get('ali').v.score, 3);
    assert.strictEqual(mdb.data.meta.get('main').counter, 7);
    assert.ok(mdb.data.state.get('main'), 'eski hujjat zaxira sifatida qolishi kerak');

    // 2) Faqat o'zgargan hujjat yoziladi
    mdb.stats.replace = 0; mdb.stats.del = 0;
    await s1.flushNow();
    assert.strictEqual(mdb.stats.replace, 0, "o'zgarish yo'q — yozuv ham yo'q");
    s1.db.tasks['1_5'].text = 'yangi';
    s1.db.tasks['2_9'] = { sid: 2, text: 'ikkinchi' };
    s1.db.counter = 8;
    await s1.flushNow();
    assert.strictEqual(mdb.stats.replace, 2);
    assert.strictEqual(mdb.data.tasks.get('2_9').v.text, 'ikkinchi');
    assert.strictEqual(mdb.data.meta.get('main').counter, 8);

    // 3) O'chirish
    delete s1.db.tasks['1_5'];
    await s1.flushNow();
    assert.strictEqual(mdb.stats.del, 1);
    assert.ok(!mdb.data.tasks.has('1_5'));

    // 4) Qayta yuklash — yangi kolleksiyalardan
    const s2 = createStore('/tmp/_unused.json');
    await s2.load(mdb);
    assert.deepStrictEqual(Object.keys(s2.db.tasks), ['2_9']);
    assert.strictEqual(s2.db.counter, 8);
    s2.db.sys.lastDaily = '2026-10-18';
    await s2.flushNow();
    assert.strictEqual(mdb.data.sys.get('lastDaily').v, '2026-10-18');

    // 5) Yuklanmagan holatda saqlash hech narsani buzmaydi
    const s3 = createStore('/tmp/_unused.json');
    await s3.flushNow();

    console.log('Barcha testlar muvaffaqiyatli o\'tdi ✅');
})().catch((e) => { console.error(e); process.exit(1); });
