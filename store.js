'use strict';
const fs = require('fs');

// Ma'lumotlar xotirada turadi (tez ishlashi uchun). MongoDB'da esa HAR BIR yozuv
// ALOHIDA hujjat sifatida saqlanadi: tasks, stats, screenshots, userChatIds, members, ignored, sys.
// Shuning uchun 16 MB chegarasi endi butun baza uchun emas, faqat bitta yozuv uchun (u esa bir necha KB).
// Saqlashda faqat O'ZGARGAN hujjatlar yoziladi, o'chirilganlari o'chiriladi.
const MAPS = ['tasks', 'stats', 'screenshots', 'userChatIds', 'members', 'ignored', 'sys'];

function createStore(filePath) {
    const db = { counter: 0 };
    MAPS.forEach((m) => { db[m] = {}; });

    let cols = null;        // { mapName: collection, meta: collection } — faqat MongoDB rejimida
    let snap = {};          // oxirgi saqlangan holat: snap[map][key] = JSON matn
    let snapCounter = null;
    let loaded = false;
    let flushTimer = null;
    let flushing = Promise.resolve();

    function fill(src) {
        MAPS.forEach((m) => {
            for (const k of Object.keys(db[m])) delete db[m][k];
            Object.assign(db[m], src[m] || {});
        });
        db.counter = src.counter || 0;
    }

    function takeSnapshot() {
        snap = {};
        MAPS.forEach((m) => {
            snap[m] = {};
            for (const k of Object.keys(db[m])) snap[m][k] = JSON.stringify(db[m][k]);
        });
        snapCounter = db.counter;
    }

    // mongoDb — MongoClient.db(...) obyekti. Bo'lmasa fayl rejimi (mahalliy sinov uchun).
    async function load(mongoDb) {
        if (mongoDb) {
            const c = {};
            MAPS.forEach((m) => { c[m] = mongoDb.collection(m); });
            c.meta = mongoDb.collection('meta');

            const metaDoc = await c.meta.findOne({ _id: 'main' });
            if (metaDoc) {
                const src = { counter: metaDoc.counter };
                for (const m of MAPS) {
                    src[m] = {};
                    const docs = await c[m].find({}).toArray();
                    for (const d of docs) src[m][d._id] = d.v;
                }
                fill(src);
                takeSnapshot();
            } else {
                // Birinchi ishga tushish: eski bitta-hujjatli bazadan ko'chiramiz (eski hujjat o'zgarmaydi — zaxira bo'lib qoladi)
                const old = await mongoDb.collection('state').findOne({ _id: 'main' });
                if (old) {
                    const { _id, ...rest } = old;
                    fill(rest);
                    console.log("Eski 'state' hujjatidan yangi kolleksiyalarga ko'chirilmoqda...");
                }
                snap = {};
                snapCounter = null; // hammasi "yangi" hisoblanadi va birinchi saqlashda yoziladi
            }
            cols = c; // faqat o'qish muvaffaqiyatli bo'lgandan keyin (bo'sh holat bazani ustidan yozmasligi uchun)
        } else if (fs.existsSync(filePath)) {
            try {
                fill(JSON.parse(fs.readFileSync(filePath, 'utf8')));
            } catch (e) {
                console.error('database.json o\'qilmadi:', e.message);
            }
        }
        loaded = true;
    }

    async function persist() {
        if (!loaded) return;
        if (!cols) {
            fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
            return;
        }
        for (const m of MAPS) {
            const prev = snap[m] || {};
            const next = {};
            const ops = [];
            for (const k of Object.keys(db[m])) {
                const s = JSON.stringify(db[m][k]);
                if (s === undefined) continue;
                next[k] = s;
                if (prev[k] !== s) {
                    ops.push({ replaceOne: { filter: { _id: k }, replacement: { _id: k, v: JSON.parse(s) }, upsert: true } });
                }
            }
            for (const k of Object.keys(prev)) {
                if (!(k in next)) ops.push({ deleteOne: { filter: { _id: k } } });
            }
            if (ops.length) await cols[m].bulkWrite(ops, { ordered: false });
            snap[m] = next; // faqat muvaffaqiyatli yozilgandan keyin; xato bo'lsa keyingi safar qayta uriniladi
        }
        if (snapCounter !== db.counter) {
            await cols.meta.replaceOne({ _id: 'main' }, { _id: 'main', counter: db.counter }, { upsert: true });
            snapCounter = db.counter;
        }
    }

    function writeDB() {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushing = flushing.then(persist).catch((e) => console.error('Saqlashda xato:', e.message));
        }, 300);
    }

    async function flushNow() {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await flushing;
        await persist();
    }

    return { db, load, writeDB, flushNow, persist };
}

module.exports = { createStore, MAPS };
