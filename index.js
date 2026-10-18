require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const H = require('./helpers');

// ==========================================
// SOZLAMALAR
// ==========================================
const PORT = process.env.PORT || 3000;
// Render avtomatik RENDER_EXTERNAL_URL beradi (masalan https://mening-botim.onrender.com)
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || '').replace(/\/+$/, '');
// Admin Telegram ID lari, vergul bilan: ADMIN_IDS=12345,67890
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

// WEBHOOK rejimi: Telegram xabarlarni to'g'ridan-to'g'ri serverga yuboradi.
// Servis uxlab qolgan bo'lsa ham, Telegram so'rovi uni uyg'otadi. Ikki nusxa to'qnashuvi (409) ham bo'lmaydi.
// Mahalliy ishga tushirishda (SELF_URL yo'q) yoki USE_POLLING=1 bo'lsa, oddiy polling ishlatiladi.
const USE_WEBHOOK = Boolean(SELF_URL) && process.env.USE_POLLING !== '1';
const hashOf = (s) => crypto.createHash('sha256').update(`${process.env.BOT_TOKEN}:${s}`).digest('hex');
const HOOK_PATH = `/tg/${hashOf('path').slice(0, 32)}`;
const HOOK_SECRET = hashOf('secret').slice(0, 48);

const startedAt = Date.now();
let lastUpdateAt = null;
let updateCount = 0;
let updateQueue = Promise.resolve(); // yangilanishlar ketma-ket qayta ishlanadi (polling'dagidek)
let markReady;
const ready = new Promise((r) => { markReady = r; }); // baza yuklanmaguncha yangilanishlar kutadi

// ==========================================
// HTTP SERVER + O'ZINI UYG'OTIB TURISH (Render bepul tarif uchun)
// ==========================================
http.createServer((req, res) => {
    if (USE_WEBHOOK && req.method === 'POST' && req.url === HOOK_PATH) {
        if (req.headers['x-telegram-bot-api-secret-token'] !== HOOK_SECRET) {
            res.writeHead(403);
            return res.end();
        }
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > 2 * 1024 * 1024) return req.destroy();
            chunks.push(c);
        });
        req.on('end', async () => {
            let update;
            try {
                update = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch (e) {
                res.writeHead(400);
                return res.end();
            }
            await ready; // baza tayyor bo'lgach javob beramiz
            lastUpdateAt = Date.now();
            updateCount++;
            updateQueue = updateQueue
                .then(() => bot.handleUpdate(update))
                .catch((e) => console.error('Yangilanishni qayta ishlashda xato:', e.message));
            res.writeHead(200);
            res.end('ok');
        });
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Bot is running and alive!\nrejim: ${USE_WEBHOOK ? 'webhook' : 'polling'}\nishlagan vaqti: ${Math.round((Date.now() - startedAt) / 60000)} daqiqa\nyangilanishlar: ${updateCount}\n`);
}).listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

if (SELF_URL) {
    // Render 15 daqiqa trafik bo'lmasa uxlatadi, shuning uchun har 4 daqiqada o'ziga so'rov yuboramiz
    setInterval(() => {
        fetch(SELF_URL).catch(() => {});
    }, 4 * 60 * 1000);
    console.log(`Self-ping yoqildi: ${SELF_URL}`);
}

// ==========================================
// MA'LUMOTLAR BAZASI (xotirada + MongoDB yoki fayl)
// ==========================================
// Har bir yozuv MongoDB'da ALOHIDA hujjat sifatida saqlanadi (store.js) — 16 MB chegarasi butun baza uchun emas.
const store = require('./store').createStore(path.join(__dirname, 'database.json'));
const db = store.db;
const writeDB = store.writeDB;
const flushNow = store.flushNow;

function normalizeDB() {
    ['tasks', 'stats', 'screenshots', 'userChatIds', 'members', 'ignored', 'sys'].forEach((k) => { if (!db[k]) db[k] = {}; });
    if (!db.counter) db.counter = 0;
    for (const id in db.tasks) {
        const t = db.tasks[id];
        if (!t.sid) { db.counter++; t.sid = db.counter; }
        if (!t.messageId) t.messageId = parseInt(id.split('_').pop());
        if (t.requiredScreenshots === undefined) {
            t.requiredScreenshots = Object.values(t.users || {})[0]?.requiredScreenshots || null;
        }
    }
}

async function initDB() {
    let mongoDb = null;
    if (process.env.MONGODB_URI) {
        const { MongoClient } = require('mongodb');
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        mongoDb = client.db(process.env.MONGODB_DB || 'topshiriq_bot');
        console.log('MongoDB ulandi.');
    } else {
        console.warn('DIQQAT: MONGODB_URI yo\'q. Ma\'lumotlar faylga yoziladi va Render\'da qayta ishga tushganda yo\'qoladi!');
    }
    await store.load(mongoDb);
    normalizeDB();
    await store.flushNow(); // eski bazadan ko'chirish natijasini va normalizatsiyani darhol saqlaymiz
}

// ==========================================
// YORDAMCHI FUNKSIYALAR
// ==========================================
const DEFAULT_USERS = [
    { name: "Aijamal", username: "aijamal", fixedKey: "aijamal" },
    { name: "Elbek Jumabekov", username: "elbek_jumabekov", fixedKey: "elbek_jumabekov" },
    { name: "Makhsud Kalbayev", username: "kalbayev_makhsud_kurbonbaevich", fixedKey: "kalbayev_makhsud_kurbonbaevich" },
    { name: "Timur Daryabayev", username: "daryabayev_timur", fixedKey: "daryabayev_timur" },
    { name: "Ali Jumamuratov", username: "ali_jumamuratov", fixedKey: "ali_jumamuratov" },
    { name: "Baxodir", username: "baxodir_6694", fixedKey: "baxodir_6694" },
    { name: "Sherzod Niyazimbetov", username: "sherzod_niyazimbetov", fixedKey: "sherzod_niyazimbetov" },
    { name: "Tilekles Mubarekov", username: "tileklesmubarekov", fixedKey: "tileklesmubarekov" },
    { name: "Qurbaniyazov Qayrat", username: "qurbaniyazovqayrat", fixedKey: "qurbaniyazovqayrat" },
    { name: "Ergash Jumaniyazov", username: "jumaniyazovergash", fixedKey: "jumaniyazovergash" },
    { name: "Saraykol OFY", username: "taxiyatosh_tumani_saraykol_ofy", fixedKey: "taxiyatosh_tumani_saraykol_ofy" },
    { name: "Atabek Saburov", username: "saburov_atabek", fixedKey: "saburov_atabek" },
    { name: "Nurbek Tajibayev", username: "nurbek_tajibayev", fixedKey: "nurbek_tajibayev" },
    { name: "Jasur Urazbaev", username: "jasururazbaev", fixedKey: "jasururazbaev" },
    { name: "Nilufar Muxammedova", username: "nilufarrmuxammedova", fixedKey: "nilufarrmuxammedova" },
    { name: "Atabek", username: "atabek", fixedKey: "atabek_16" }
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pendingFiles = new Map(); // userId -> file (bir nechta topshiriq bo'lganda tanlash uchun)

const findTaskId = (sid) => Object.keys(db.tasks).find((id) => db.tasks[id].sid === sid);

// Faqat id yoki username bo'yicha moslashtiramiz (ism bo'yicha emas)
function matchKey(task, userId, username) {
    for (const key in task.users) {
        const u = task.users[key];
        if (key === userId) return key;
        if (u.id && String(u.id) === userId) return key;
        if (username && u.username && u.username.toLowerCase() === username) return key;
    }
    return null;
}

function isBotAdmin(userId) {
    const id = String(userId);
    if (ADMIN_IDS.includes(id)) return true;
    return Object.values(db.tasks).some((t) => String(t.adminId) === id);
}

// Topshiriqni faqat uni bergan admin (yoki ADMIN_IDS dagilar) boshqara oladi
const canManage = (userId, task) => ADMIN_IDS.includes(String(userId)) || String(task.adminId) === String(userId);

async function isGroupAdmin(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (error) {
        return false;
    }
}

const addScore = (username, name, points, completedDelta = 0) => {
    const key = username ? username.toLowerCase() : name;
    if (!db.stats[key]) db.stats[key] = { name: name, score: 0, completed: 0 };
    db.stats[key].score = Math.max(0, db.stats[key].score + points);
    db.stats[key].completed = Math.max(0, db.stats[key].completed + completedDelta);
};

function generateUserList(task, shots = {}) {
    let out = '';
    let n = 1;
    let total = 0;
    for (const key in task.users) {
        const u = task.users[key];
        let icon = '🔴';
        let info = ' (Танишмади)';
        if (u.status === 'bajarildi') { icon = '✅'; info = ' (Бажарди)'; }
        else if (u.status === 'tanishdi') { icon = '🔵'; info = ' (Танишди)'; }
        if (u.status === 'bajarildi' && u.late) info = ' (Кечикиб бажарди)';
        if (u.status !== 'bajarildi') {
            if (u.extendedUntil && !u.late) { icon = '🟡'; info = ` (Муддат: ${H.fmt(u.extendedUntil)})`; }
            else if (u.excused) { icon = '🟡'; info = ' (Узрли)'; }
            else if (u.late) { icon = '⏰'; info = ' (Кечикди)'; }
        }

        if (u.requiredScreenshots) {
            const c = (shots[key] || []).length;
            total += c;
            info = ` (${c}/${u.requiredScreenshots} та скриншот)`;
        }
        out += `${n}. ${icon} ${esc(u.name)}${info}\n`;
        n++;
    }
    if (task.requiredScreenshots) out += `\n📊 <b>Умумий юборилган скриншотлар:</b> ${total} та`;
    return out;
}

function renderTaskText(taskId) {
    const task = db.tasks[taskId];
    const list = generateUserList(task, db.screenshots[taskId] || {});
    const req = task.requiredScreenshots;
    const dl = task.deadlineAt ? `\n⏳ <b>Муддат:</b> ${H.fmt(task.deadlineAt)}` : '';
    const botName = bot.botInfo && bot.botInfo.username;

    const build = (txt) => {
        if (task.status === 'closed') {
            return `🔒 <b>БУ ТОПШИРИҚ ЁПИЛГАН</b>\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}${dl}\n\n📝 <b>Вазифа:</b> ${esc(txt)}\n\n<b>Якуний ҳолат:</b>\n${list}`;
        }
        const header = req
            ? `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${req} та)!</b>`
            : `📋 <b>ЯНГИ ВАЗИФА!</b>`;
        const hint = req && botName ? `\n\n📩 Скриншотни @${botName} га шахсий чатда юборинг (аввал /start босинг).` : '';
        return `${header}\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}${dl}\n\n📝 <b>Вазифа:</b> ${esc(txt)}\n\n<b>Топшириқ ҳолати:</b>\n${list}${hint}`;
    };

    let txt = task.text;
    let out = build(txt);
    // Медиа хабарда caption 1024 белгидан oshmasligi kerak
    if (task.hasMedia) {
        while (out.length > 1024 && txt.length > 0) {
            txt = txt.slice(0, Math.max(0, txt.length - 30));
            out = build(txt + '…');
        }
    }
    return out;
}

const taskKeyboard = (task) =>
    task.status === 'open'
        ? { inline_keyboard: [[{ text: "👁 Танишдим", callback_data: "tanishdim" }], [{ text: "🔒 Топшириқни ёпиш", callback_data: "yopish" }]] }
        : { inline_keyboard: [] };

async function refreshTaskMessage(taskId) {
    const task = db.tasks[taskId];
    if (!task) return;
    const text = renderTaskText(taskId);
    const opts = { parse_mode: 'HTML', reply_markup: taskKeyboard(task) };
    try {
        if (task.hasMedia) {
            await bot.telegram.editMessageCaption(task.chatId, task.messageId, undefined, text, opts);
        } else {
            await bot.telegram.editMessageText(task.chatId, task.messageId, undefined, text, opts);
        }
    } catch (err) {
        const msg = String(err.description || err.message || '');
        if (!msg.includes('not modified')) console.error('Xabarni yangilashda xato:', msg);
    }
}

async function attachScreenshot(taskId, key, file) {
    const task = db.tasks[taskId];
    const u = task.users[key];
    if (!db.screenshots[taskId]) db.screenshots[taskId] = {};
    if (!db.screenshots[taskId][key]) db.screenshots[taskId][key] = [];
    const arr = db.screenshots[taskId][key];
    const required = u.requiredScreenshots;

    // Бир хил расмни қайта (ёки бошқа ходим номидан) юборишни рад этамиз
    const dupMine = arr.some((x) => x.uniqueId === file.uniqueId);
    const dupOther = Object.keys(db.screenshots[taskId]).some((k) => k !== key && db.screenshots[taskId][k].some((x) => x.uniqueId === file.uniqueId));
    if (dupMine) return '⚠️ Бу скриншот аллақачон юборилган. Бошқа скриншот юборинг.';
    if (dupOther) return '⚠️ Бу скриншот бошқа иштирокчи томонидан юборилган. Ўзингизнинг скриншотингизни юборинг.';
    if (arr.length >= required) return `ℹ️ Талаб қилинган ${required} та скриншот аллақачон юборилган.`;

    arr.push(file);
    if (arr.length >= required && u.status !== 'bajarildi') {
        u.status = 'bajarildi';
        markLate(task, u);
        addScore(u.username, u.name, 5, 1);
    }
    writeDB();
    await refreshTaskMessage(taskId);
    return `✅ Скриншот қабул қилинди! (${arr.length}/${required})`;
}

// ==========================================
// /start
// ==========================================
bot.start((ctx) => {
    if (ctx.chat.type === 'private') {
        const userId = ctx.from.id.toString();
        const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
        db.userChatIds[userId] = userId;
        if (username) db.userChatIds[username] = userId;
        writeDB();
        ctx.reply("Ассалому алайкум! Топшириқлар ботига уландингиз. Скриншотларни шу ерга юборишингиз мумкин.\n\n📋 /mening — менинг топшириқларим\n✉️ /sabab — узр сабабини юбориш\n\nАдмин панели учун: /admin");
    } else {
        ctx.reply("Ассалому алайкум! Топшириқлар ботига хуш келибсиз.");
    }
});

// ==========================================
// АДМИН ПАНЕЛЬ (ЛИЧКАДА)
// ==========================================
bot.command('admin', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply("Бу буйруқ фақат ботнинг шахсий чатида (личкада) ишлайди.");
    if (!isBotAdmin(ctx.from.id)) {
        return ctx.reply(`Сизда админ ҳуқуқи йўқ.\nСизнинг Telegram ID: ${ctx.from.id}\n(Бу ID ни ADMIN_IDS га қўшиш керак.)`);
    }

    const openTasks = Object.keys(db.tasks).filter((tid) => db.tasks[tid].status === 'open' && canManage(ctx.from.id, db.tasks[tid]));
    if (openTasks.length === 0) return ctx.reply("Ҳозирча гуруҳларда очиқ топшириқлар мавжуд эмас.");

    const buttons = openTasks.map((tid) => {
        const t = db.tasks[tid];
        return [{ text: `📌 ${t.text.substring(0, 30)}...`, callback_data: `at:${t.sid}` }];
    });
    await ctx.reply("Админ панель: Текширмоқчи бўлган топшириқни танланг:", { reply_markup: { inline_keyboard: buttons } });
});

bot.action(/^at:(\d+)$/, async (ctx) => {
    if (!isBotAdmin(ctx.from.id)) return ctx.answerCbQuery("Рухсат йўқ.", { show_alert: true });
    const taskId = findTaskId(parseInt(ctx.match[1]));
    const task = db.tasks[taskId];
    if (!task || !canManage(ctx.from.id, task)) return ctx.answerCbQuery("Топшириқ топилмади ёки рухсат йўқ.", { show_alert: true });

    const buttons = Object.keys(task.users).map((uKey, idx) => {
        const count = (db.screenshots[taskId]?.[uKey] || []).length;
        return [{ text: `👤 ${task.users[uKey].name} (${count} та скриншот)`, callback_data: `au:${task.sid}:${idx}` }];
    });

    await ctx.editMessageText(`📌 <b>Топшириқ:</b> ${esc(task.text)}\n\nИштирокчилардан бирини танланг:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
    ctx.answerCbQuery().catch(() => {});
});

bot.action(/^au:(\d+):(\d+)$/, async (ctx) => {
    if (!isBotAdmin(ctx.from.id)) return ctx.answerCbQuery("Рухсат йўқ.", { show_alert: true });
    const sid = parseInt(ctx.match[1]);
    const taskId = findTaskId(sid);
    const task = db.tasks[taskId];
    if (!task || !canManage(ctx.from.id, task)) return ctx.answerCbQuery("Топшириқ топилмади ёки рухсат йўқ.", { show_alert: true });

    const userKey = Object.keys(task.users)[parseInt(ctx.match[2])];
    const uObj = task.users[userKey];
    if (!uObj) return ctx.answerCbQuery("Фойдаланувчи топилмади.", { show_alert: true });

    const files = db.screenshots[taskId]?.[userKey] || [];
    if (files.length === 0) return ctx.answerCbQuery("Бу фойдаланувчи ҳали скриншот юбормаган.", { show_alert: true });

    await ctx.answerCbQuery("Расмлар юкланмоқда...");
    await ctx.reply(`👤 <b>${esc(uObj.name)}</b> томонидан юборилган скриншотлар (${files.length} та):`, { parse_mode: 'HTML' });

    const idx = ctx.match[2];
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const extra = {
            caption: `Расм #${i + 1} (${uObj.name})`,
            reply_markup: {
                inline_keyboard: [[{ text: "❌ Ушбу расмни рад этиш ва ўчириш", callback_data: `ds:${sid}:${idx}:${f.uniqueId}` }]]
            }
        };
        try {
            if (f.type === 'document') await ctx.replyWithDocument(f.fileId, extra);
            else await ctx.replyWithPhoto(f.fileId, extra);
        } catch (e) {
            console.error('Расм юборилмади:', e.message);
        }
    }
});

// Rasmni indeks emas, file_unique_id bo'yicha o'chiramiz (indekslar siljishi muammosi yo'q)
bot.action(/^ds:(\d+):(\d+):(.+)$/, async (ctx) => {
    if (!isBotAdmin(ctx.from.id)) return ctx.answerCbQuery("Рухсат йўқ.", { show_alert: true });
    const taskId = findTaskId(parseInt(ctx.match[1]));
    const task = db.tasks[taskId];
    if (!task || !canManage(ctx.from.id, task)) return ctx.answerCbQuery("Маълумот топилмади.", { show_alert: true });

    const userKey = Object.keys(task.users)[parseInt(ctx.match[2])];
    const uObj = task.users[userKey];
    if (!uObj) return ctx.answerCbQuery("Маълумот топилмади.", { show_alert: true });

    const uniqueId = ctx.match[3];
    const files = db.screenshots[taskId]?.[userKey] || [];
    const i = files.findIndex((f) => f.uniqueId === uniqueId);
    if (i === -1) {
        await ctx.answerCbQuery("Бу расм аллақачон ўчирилган.", { show_alert: true });
        return ctx.editMessageCaption("❌ Ушбу расм аллақачон ўчирилган.").catch(() => {});
    }

    files.splice(i, 1);
    if (uObj.requiredScreenshots && files.length < uObj.requiredScreenshots && uObj.status === 'bajarildi') {
        uObj.status = 'tanishmadi';
        addScore(uObj.username, uObj.name, -5, -1);
    }
    writeDB();
    await refreshTaskMessage(taskId);

    await ctx.answerCbQuery("✅ Расм рад этилиб, ўчириб ташланди!");
    await ctx.editMessageCaption("❌ Ушбу расм рад этилиб, ўчирилди.").catch(() => {});

    // Ishtirokchiga xabar berish
    const chatId = db.userChatIds[userKey] || db.userChatIds[(uObj.username || '').toLowerCase()];
    if (chatId) {
        bot.telegram.sendMessage(chatId, `❌ Сиз юборган скриншотлардан бири рад этилди. Топшириқ: ${task.text.substring(0, 60)}\nИлтимос, қайта юборинг.`).catch(() => {});
    }
});

// Bir nechta topshiriq bo'lganda skrinshotni qaysi topshiriqqa qo'shishni tanlash
bot.action(/^pk:(\d+)$/, async (ctx) => {
    const userId = String(ctx.from.id);
    const file = pendingFiles.get(userId);
    if (!file) return ctx.answerCbQuery("Расм топилмади, қайта юборинг.", { show_alert: true });

    const taskId = findTaskId(parseInt(ctx.match[1]));
    const task = db.tasks[taskId];
    if (!task || task.status !== 'open') return ctx.answerCbQuery("Топшириқ ёпилган.", { show_alert: true });

    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    const key = matchKey(task, userId, username);
    if (!key || !task.users[key].requiredScreenshots) return ctx.answerCbQuery("Сиз бу топшириқда йўқсиз.", { show_alert: true });

    pendingFiles.delete(userId);
    const msg = await attachScreenshot(taskId, key, file);
    await ctx.answerCbQuery("Қабул қилинди");
    await ctx.editMessageText(msg).catch(() => {});
});

// ==========================================
// ТОПШИРИҚНИ ПАСТГА ТУШИРИШ (/up, /qayta)
// Статуслар ва скриншотлар сақланади, фақат хабар чат охирига қайта жойланади
// ==========================================
async function bumpTask(oldTaskId) {
    const task = db.tasks[oldTaskId];
    const text = renderTaskText(oldTaskId);
    const extra = { parse_mode: 'HTML', reply_markup: taskKeyboard(task) };

    let sent;
    if (task.hasMedia) {
        extra.caption = text;
        sent = await bot.telegram.copyMessage(task.chatId, task.chatId, task.messageId, extra);
    } else {
        sent = await bot.telegram.sendMessage(task.chatId, text, extra);
    }

    const oldMsgId = task.messageId;
    const newTaskId = `${task.chatId}_${sent.message_id}`;
    task.messageId = sent.message_id;
    db.tasks[newTaskId] = task;
    delete db.tasks[oldTaskId];
    if (db.screenshots[oldTaskId]) {
        db.screenshots[newTaskId] = db.screenshots[oldTaskId];
        delete db.screenshots[oldTaskId];
    }
    writeDB();

    await bot.telegram.deleteMessage(task.chatId, oldMsgId).catch(() => {});
}

bot.command(['up', 'qayta'], async (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply("Бу буйруқ гуруҳда ишлайди.");

    if (!(await isGroupAdmin(ctx))) {
        return ctx.deleteMessage().catch(() => {});
    }

    let oldTaskId = null;
    const rep = ctx.message.reply_to_message;

    if (rep) {
        const id = `${ctx.chat.id}_${rep.message_id}`;
        if (db.tasks[id]) {
            if (db.tasks[id].status !== 'open') {
                await ctx.deleteMessage().catch(() => {});
                return ctx.reply("Бу топшириқ ёпилган.");
            }
            oldTaskId = id;
        }
    }

    // Reply бўлмаса — шу гуруҳдаги энг сўнгги очиқ топшириқ
    if (!oldTaskId) {
        const open = Object.keys(db.tasks)
            .filter((id) => db.tasks[id].chatId === ctx.chat.id && db.tasks[id].status === 'open')
            .sort((a, b) => db.tasks[b].sid - db.tasks[a].sid);
        oldTaskId = open[0] || null;
    }

    if (!oldTaskId) {
        await ctx.deleteMessage().catch(() => {});
        return ctx.reply("Бу гуруҳда очиқ топшириқ топилмади.");
    }

    try {
        await bumpTask(oldTaskId);
    } catch (e) {
        console.error('Пастга туширишда хато:', e.message);
        await ctx.reply("Топшириқни қайта жойлаб бўлмади. Эски хабар ўчирилган бўлиши мумкин.");
    }
    await ctx.deleteMessage().catch(() => {});
});

// ==========================================
// ХАБАРЛАР
// ==========================================
// ==========================================
// ИШТИРОКЧИЛАР РЎЙХАТИ (ҳар гуруҳ учун базада сақланади)
// ==========================================
function getRoster(chatId) {
    if (!db.members) db.members = {};
    if (!db.members[chatId]) {
        const r = {};
        DEFAULT_USERS.forEach((u) => { r[u.fixedKey] = { name: u.name, username: u.username }; });
        db.members[chatId] = r;
        writeDB();
    }
    return db.members[chatId];
}

function getIgnored(chatId) {
    if (!db.ignored) db.ignored = {};
    if (!db.ignored[chatId]) db.ignored[chatId] = {};
    return db.ignored[chatId];
}

// Одамни рўйхатга қўшади/боғлайди. force=true бўлса (масалан, "Танишдим" босганда) админни ҳам қўшади.
async function trackMember(chatId, user, force = false) {
    if (!user || user.is_bot || user.id === 777000) return;
    const roster = getRoster(chatId);
    const ign = getIgnored(chatId);
    const uid = String(user.id);
    const uname = user.username ? user.username.toLowerCase() : null;

    for (const key in roster) {
        const m = roster[key];
        if (String(m.id) === uid || key === uid || (uname && m.username && m.username.toLowerCase() === uname)) {
            if (!m.id) { m.id = user.id; writeDB(); }
            return;
        }
    }

    if (force) {
        delete ign[uid];
        if (uname) delete ign[uname];
    } else {
        if (ign[uid] || (uname && ign[uname])) return;
        try {
            const cm = await bot.telegram.getChatMember(chatId, user.id);
            if (['creator', 'administrator'].includes(cm.status)) {
                ign[uid] = true;
                writeDB();
                return;
            }
        } catch (e) {
            return;
        }
    }

    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || uname || uid;
    roster[uname || uid] = { name, username: uname, id: user.id };
    writeDB();
}

bot.on('new_chat_members', async (ctx) => {
    for (const u of ctx.message.new_chat_members) await trackMember(ctx.chat.id, u);
});

bot.on('left_chat_member', async (ctx) => {
    const u = ctx.message.left_chat_member;
    if (!u || u.is_bot) return;
    const roster = getRoster(ctx.chat.id);
    const ign = getIgnored(ctx.chat.id);
    const uid = String(u.id);
    const uname = u.username ? u.username.toLowerCase() : null;
    const key = Object.keys(roster).find((k) =>
        String(roster[k].id) === uid || k === uid || (uname && (roster[k].username || '').toLowerCase() === uname));
    if (key) {
        delete roster[key];
        ign[uid] = true;
        if (uname) ign[uname] = true;
        writeDB();
    }
});

bot.command('royxat', async (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply("Бу буйруқ гуруҳда ишлайди.");
    if (!(await isGroupAdmin(ctx))) return ctx.deleteMessage().catch(() => {});
    const roster = getRoster(ctx.chat.id);
    const keys = Object.keys(roster);
    const lines = keys.map((k, i) => {
        const m = roster[k];
        return `${i + 1}. ${esc(m.name)}${m.username ? ` — <code>${esc(m.username)}</code>` : ''}`;
    });
    await ctx.reply(`👥 <b>Иштирокчилар рўйхати (${keys.length} киши):</b>\n\n${lines.join('\n')}\n\nЎчириш: /ochir рақам ёки /ochir username\nҚўшиш: /qosh @username Исм Фамилия`, { parse_mode: 'HTML' });
    await ctx.deleteMessage().catch(() => {});
});

bot.command('qosh', async (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply("Бу буйруқ гуруҳда ишлайди.");
    if (!(await isGroupAdmin(ctx))) return ctx.deleteMessage().catch(() => {});

    const args = ctx.message.text.split(/\s+/).slice(1);
    const m = (args[0] || '').match(/^@?([a-zA-Z0-9_]{3,})$/);
    if (!m) return ctx.reply("Фойдаланиш: /qosh @username Исм Фамилия");

    const uname = m[1].toLowerCase();
    const name = args.slice(1).join(' ') || m[1];
    const roster = getRoster(ctx.chat.id);
    delete getIgnored(ctx.chat.id)[uname];

    const existing = Object.keys(roster).find((k) => (roster[k].username || '').toLowerCase() === uname);
    if (existing) roster[existing].name = name;
    else roster[uname] = { name, username: uname };
    writeDB();

    await ctx.reply(`✅ ${esc(name)} (<code>${esc(uname)}</code>) рўйхатга қўшилди. Рўйхатда ${Object.keys(roster).length} киши. Кейинги топшириқлардан бошлаб чиқади.`, { parse_mode: 'HTML' });
    await ctx.deleteMessage().catch(() => {});
});

bot.command('ochir', async (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply("Бу буйруқ гуруҳда ишлайди.");
    if (!(await isGroupAdmin(ctx))) return ctx.deleteMessage().catch(() => {});

    const arg = (ctx.message.text.split(/\s+/)[1] || '').trim();
    const roster = getRoster(ctx.chat.id);
    const keys = Object.keys(roster);
    let key = null;
    if (/^\d+$/.test(arg)) {
        key = keys[parseInt(arg) - 1];
    } else if (arg) {
        const un = arg.replace(/^@/, '').toLowerCase();
        key = keys.find((k) => (roster[k].username || '').toLowerCase() === un);
    }
    if (!key) return ctx.reply("Фойдаланиш: /ochir рақам (рўйхатдаги) ёки /ochir username");

    const m = roster[key];
    delete roster[key];
    const ign = getIgnored(ctx.chat.id);
    if (m.id) ign[String(m.id)] = true;
    if (m.username) ign[m.username.toLowerCase()] = true;
    writeDB();

    await ctx.reply(`🗑 ${esc(m.name)} рўйхатдан ўчирилди (кейинги топшириқлардан). Қолди: ${Object.keys(roster).length} киши.`, { parse_mode: 'HTML' });
    await ctx.deleteMessage().catch(() => {});
});

// ==========================================
// МУДДАТ, ЭСЛАТМАЛАР, ҲИСОБОТЛАР, УЗР СЎРАШ
// ==========================================
const HOUR = H.HOUR;
const DAILY_HOUR = Number(process.env.DAILY_HOUR || 8); // Тошкент вақти билан, соат нечада кундалик хулоса келади
const DAILY_WEEKDAYS = (process.env.DAILY_WEEKDAYS || '1,2,3,4,5').split(',').map((s) => Number(s.trim())); // 1 = душанба
const awaiting = new Map(); // userId -> { sid, at } (узр сабаби кутилмоқда)

const isDone = (u) => u.status === 'bajarildi';
const userDeadline = (task, u) => u.extendedUntil || task.deadlineAt || null;
const mentionOf = (u) => (u.id
    ? `<a href="tg://user?id=${u.id}">${esc(u.name)}</a>`
    : (u.username ? `@${esc(u.username)}` : esc(u.name)));
const taskLink = (task) => (String(task.chatId).startsWith('-100')
    ? `https://t.me/c/${String(task.chatId).slice(4)}/${task.messageId}`
    : null);
const chatIdOf = (key, u) => db.userChatIds[String(u.id)] || db.userChatIds[key] || db.userChatIds[(u.username || '').toLowerCase()] || null;

// Муддатдан кейин бажарилган бўлса — "кечикиб бажарди" деб белгилайди
function markLate(task, u) {
    const dl = userDeadline(task, u);
    if (dl && Date.now() > dl) u.late = true;
}

// Топшириқни берган админга шахсий чатда хабар (админ ботга /start босган бўлиши керак)
async function dmAdmin(task, text, extra = {}) {
    try {
        await bot.telegram.sendMessage(task.adminId, text, { parse_mode: 'HTML', ...extra });
        return true;
    } catch (e) {
        console.error('Админга хабар юборилмади:', e.description || e.message);
        return false;
    }
}

const replyTo = (task) => ({ reply_parameters: { message_id: task.messageId, allow_sending_without_reply: true } });

// ---------- Гуруҳга эслатма: фақат бажармаганлар теглаб юборилади ----------
async function remindGroup(task, kind) {
    const list = Object.values(task.users).filter((u) => !isDone(u) && !u.excused && !u.extendedUntil);
    if (!list.length) return;
    const head = kind === 'h3'
        ? '🚨 <b>Диққат! Муддатга 3 соатдан кам вақт қолди.</b>'
        : '⏰ <b>Эслатма: муддатга 24 соатдан кам вақт қолди.</b>';
    for (const part of H.chunk(list, 25)) {
        const text = `${head}\n📝 ${esc(H.short(task.text, 100))}\n⏳ <b>Муддат:</b> ${H.fmt(task.deadlineAt)}\n\n<b>Ҳали бажармаганлар:</b>\n${part.map(mentionOf).join(', ')}`;
        await bot.telegram.sendMessage(task.chatId, text, { parse_mode: 'HTML', ...replyTo(task) })
            .catch((e) => console.error('Эслатма юборилмади:', e.description || e.message));
    }
    task.lastReminderTime = Date.now();
}

// ---------- Муддат тугаганда админга: ким бажармади ----------
async function reportOverdue(task) {
    const us = Object.values(task.users);
    const done = us.filter(isDone);
    const notDone = us.filter((u) => !isDone(u) && !u.excused && !u.extendedUntil);
    const ext = us.filter((u) => !isDone(u) && u.extendedUntil);
    const exc = us.filter((u) => !isDone(u) && u.excused);
    const line = (u, i) => `${i + 1}. ${esc(u.name)}${u.username ? ` (@${esc(u.username)})` : ''}`;

    let out = `⌛ <b>Муддат тугади</b>\n📝 ${esc(H.short(task.text, 120))}\n⏳ ${H.fmt(task.deadlineAt)}\n\n✅ Бажарди: ${done.length}/${us.length}`;
    if (notDone.length) {
        out += `\n\n❌ <b>Бажармаганлар (${notDone.length}):</b>\n${notDone.slice(0, 60).map(line).join('\n')}`;
        if (notDone.length > 60) out += `\n…ва яна ${notDone.length - 60} та`;
    } else if (!ext.length) {
        out += '\n\n🎉 Ҳамма бажарди!';
    }
    if (ext.length) out += `\n\n📅 <b>Муддати узайтирилган:</b>\n${ext.map((u) => `• ${esc(u.name)} — ${H.fmt(u.extendedUntil)}`).join('\n')}`;
    if (exc.length) out += `\n\n🟡 <b>Узрли:</b> ${exc.map((u) => esc(u.name)).join(', ')}`;
    const link = taskLink(task);
    if (link) out += `\n\n<a href="${link}">Топшириққа ўтиш</a>`;
    await dmAdmin(task, out);
}

// ---------- Кундалик хулоса (эрталаб) ----------
async function sendDaily() {
    const now = Date.now();
    const byAdmin = {};
    for (const t of Object.values(db.tasks)) {
        if (t.status !== 'open') continue;
        (byAdmin[t.adminId] = byAdmin[t.adminId] || []).push(t);
    }
    for (const adminId of Object.keys(byAdmin)) {
        const list = byAdmin[adminId].sort((a, b) => (a.deadlineAt || Infinity) - (b.deadlineAt || Infinity));
        let out = `☀️ <b>Хайрли тонг! Очиқ топшириқлар: ${list.length} та</b>\n`;
        for (const t of list.slice(0, 15)) {
            const us = Object.values(t.users);
            const done = us.filter(isDone).length;
            let flag = '';
            if (t.deadlineAt) flag = t.deadlineAt < now ? ' 🔴 муддати ўтган' : (t.deadlineAt - now < 24 * HOUR ? ' 🟠 24 соатдан кам' : '');
            out += `\n📝 ${esc(H.short(t.text, 60))}\n    ✅ ${done}/${us.length}${t.deadlineAt ? ` | ⏳ ${H.fmt(t.deadlineAt)}` : ''}${flag}\n`;
        }
        if (list.length > 15) out += `\n…ва яна ${list.length - 15} та`;
        await bot.telegram.sendMessage(adminId, out, { parse_mode: 'HTML' })
            .catch((e) => console.error('Кундалик хулоса юборилмади:', e.description || e.message));
    }
}

// ---------- Ҳар дақиқада текширув ----------
async function checkTask(taskId) {
    const task = db.tasks[taskId];
    if (!task || task.status !== 'open') return;
    const now = Date.now();
    let dirty = false;
    const r = task.reminders || (task.reminders = {});

    if (task.deadlineAt) {
        const left = task.deadlineAt - now;
        if (left > 0 && left <= 3 * HOUR && !r.h3) {
            r.h3 = true; r.h24 = true; dirty = true;
            await remindGroup(task, 'h3');
        } else if (left > 0 && left <= 24 * HOUR && !r.h24) {
            r.h24 = true; dirty = true;
            await remindGroup(task, 'h24');
        }
    }

    for (const u of Object.values(task.users)) {
        if (isDone(u) || u.excused) continue;
        const dl = userDeadline(task, u);
        if (!dl) continue;
        if (u.extendedUntil && !u.remExt && dl > now && dl - now <= 3 * HOUR) {
            u.remExt = true; dirty = true;
            await bot.telegram.sendMessage(task.chatId,
                `🚨 ${mentionOf(u)}, шахсий муддатингизга 3 соатдан кам қолди (${H.fmt(dl)}).\n📝 ${esc(H.short(task.text, 80))}`,
                { parse_mode: 'HTML', ...replyTo(task) }).catch(() => {});
        }
        if (!u.late && now > dl) { u.late = true; dirty = true; } // "кечикди"
    }

    if (task.deadlineAt && now >= task.deadlineAt && !task.deadlineReported) {
        task.deadlineReported = true; dirty = true;
        await reportOverdue(task);
    }

    if (dirty) {
        writeDB();
        await refreshTaskMessage(taskId);
    }
}

let ticking = false;
async function tick() {
    if (ticking) return;
    ticking = true;
    try {
        for (const taskId of Object.keys(db.tasks)) {
            try { await checkTask(taskId); } catch (e) { console.error('Текширувда хато:', e.message); }
        }
        const p = H.tzParts();
        if (p.h >= DAILY_HOUR && p.h < DAILY_HOUR + 4 && DAILY_WEEKDAYS.includes(p.dow) && db.sys.lastDaily !== H.dateKey()) {
            db.sys.lastDaily = H.dateKey();
            writeDB();
            await sendDaily();
        }
    } finally {
        ticking = false;
    }
}

ready.then(() => {
    const run = () => tick().catch((e) => console.error('tick xatosi:', e.message));
    setTimeout(run, 15 * 1000); // ишга тушгач, ўтказиб юборилган эслатмаларни дарҳол қувиб етиш
    setInterval(run, 60 * 1000);
});

// ---------- Ёрдамчилар ----------
async function groupAdminOnly(ctx) {
    if (ctx.chat.type === 'private') { await ctx.reply('Бу буйруқ гуруҳда ишлайди.'); return false; }
    if (!(await isGroupAdmin(ctx))) { await ctx.deleteMessage().catch(() => {}); return false; }
    return true;
}

// reply қилинган топшириқ, бўлмаса — гуруҳдаги энг сўнгги очиқ топшириқ
function findTargetTask(ctx) {
    const rep = ctx.message.reply_to_message;
    if (rep) {
        const id = `${ctx.chat.id}_${rep.message_id}`;
        if (db.tasks[id] && db.tasks[id].status === 'open') return id;
    }
    const open = Object.keys(db.tasks)
        .filter((id) => db.tasks[id].chatId === ctx.chat.id && db.tasks[id].status === 'open')
        .sort((a, b) => db.tasks[b].sid - db.tasks[a].sid);
    return open[0] || null;
}

// ---------- Гуруҳлар (#nom) — тез-тез бериладиган ходимлар тўплами ----------
function getGroups(chatId) {
    const k = `groups_${chatId}`;
    if (!db.sys[k]) db.sys[k] = {};
    return db.sys[k];
}

const findRosterKey = (roster, handle) => Object.keys(roster).find((k) => (roster[k].username || '').toLowerCase() === handle);

// "@ali" ва "#гуруҳ" ларни рўйхатдаги ходимлар калитига айлантиради
function resolveTargets(chatId, wanted) {
    const roster = getRoster(chatId);
    const groups = getGroups(chatId);
    const keys = new Set();
    const unknown = [];
    for (const handle of wanted.handles) {
        const k = findRosterKey(roster, handle);
        if (k) keys.add(k); else unknown.push(`@${handle}`);
    }
    for (const tag of wanted.tags) {
        if (!groups[tag]) { unknown.push(`#${tag}`); continue; }
        groups[tag].forEach((k) => { if (roster[k]) keys.add(k); }); // рўйхатдан ўчирилганлари ҳисобга олинмайди
    }
    if (unknown.length) {
        return { error: `Рўйхатда топилмади: ${unknown.join(', ')}\n/royxat — рўйхат, /qosh @username Исм — қўшиш, /guruh — гуруҳлар.` };
    }
    if (!keys.size) return { error: 'Танланган гуруҳда ходим қолмаган. /guruh орқали қайта тузинг.' };
    return { keys: [...keys] };
}

// /guruh — рўйхат | /guruh nom @a @b 3 — тузиш/янгилаш (рақам — /royxat даги тартиб) | /guruh ochir nom
bot.command('guruh', async (ctx) => {
    if (!(await groupAdminOnly(ctx))) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    const roster = getRoster(ctx.chat.id);
    const groups = getGroups(ctx.chat.id);

    if (!args.length) {
        const names = Object.keys(groups);
        if (!names.length) {
            return ctx.reply('Ҳали гуруҳ йўқ.\nТузиш: /guruh туман1 @ali @elbek 3\n(рақам — /royxat даги тартиб рақами)\nФойдаланиш: /topshiriq #туман1 25.10 18:00 матн');
        }
        const lines = names.map((n) => {
            const members = groups[n].filter((k) => roster[k]).map((k) => roster[k].name);
            return `#${esc(n)} — ${members.length} киши: ${esc(H.short(members.join(', '), 120))}`;
        });
        return ctx.reply(`👥 <b>Гуруҳлар:</b>\n\n${lines.join('\n')}\n\nЎчириш: /guruh ochir ном`, { parse_mode: 'HTML' });
    }

    if (args[0].toLowerCase() === 'ochir') {
        const n = (args[1] || '').replace(/^#/, '').toLowerCase();
        if (!groups[n]) return ctx.reply('Бундай гуруҳ топилмади. Рўйхат: /guruh');
        delete groups[n];
        writeDB();
        return ctx.reply(`🗑 #${esc(n)} гуруҳи ўчирилди.`, { parse_mode: 'HTML' });
    }

    const name = args[0].replace(/^#/, '').toLowerCase();
    if (!/^[\p{L}\p{N}_]{1,30}$/u.test(name)) return ctx.reply('Гуруҳ номи фақат ҳарф, рақам ва _ дан иборат бўлсин (30 тагача).');
    const rosterKeys = Object.keys(roster);
    const keys = new Set();
    const unknown = [];
    for (const tok of args.slice(1)) {
        const t = tok.replace(/[,;]$/, '');
        if (/^\d+$/.test(t)) {
            const k = rosterKeys[parseInt(t) - 1];
            if (k) keys.add(k); else unknown.push(t);
        } else {
            const k = findRosterKey(roster, t.replace(/^@/, '').toLowerCase());
            if (k) keys.add(k); else unknown.push(t);
        }
    }
    if (unknown.length) return ctx.reply(`Рўйхатда топилмади: ${unknown.join(', ')}\n/royxat орқали текширинг.`);
    if (!keys.size) return ctx.reply('Фойдаланиш: /guruh туман1 @ali @elbek 3');

    groups[name] = [...keys];
    writeDB();
    await ctx.reply(`✅ <b>#${esc(name)}</b> гуруҳи сақланди (${keys.size} киши): ${esc(H.short([...keys].map((k) => roster[k].name).join(', '), 200))}\nФойдаланиш: /topshiriq #${esc(name)} 25.10 18:00 матн`, { parse_mode: 'HTML' });
    await ctx.deleteMessage().catch(() => {});
});

// ---------- /muddat — муддатни ўзгартириш/узайтириш ----------
bot.command('muddat', async (ctx) => {
    if (!(await groupAdminOnly(ctx))) return;
    const arg = ctx.message.text.replace(/^\/muddat(@\w+)?/i, '').trim();
    const p = H.parseDeadline(arg);
    if (!p || p.error) {
        return ctx.reply(p && p.error === 'past'
            ? 'Бу вақт ўтиб кетган. Келажакдаги санани киритинг.'
            : 'Фойдаланиш: /muddat 28.10 18:00\n(Топшириқ хабарига reply қилинг, акс ҳолда охирги очиқ топшириққа қўлланади.)');
    }
    const taskId = findTargetTask(ctx);
    if (!taskId) return ctx.reply('Бу гуруҳда очиқ топшириқ топилмади.');
    const task = db.tasks[taskId];

    task.deadlineAt = p.at;
    const left = p.at - Date.now();
    task.reminders = { h24: left <= 24 * HOUR, h3: left <= 3 * HOUR };
    task.deadlineReported = false;
    for (const u of Object.values(task.users)) {
        if (u.extendedUntil && u.extendedUntil <= p.at) { u.extendedUntil = null; u.remExt = false; }
        if (!isDone(u)) u.late = false;
    }
    writeDB();
    await refreshTaskMessage(taskId);
    await ctx.reply(`🔄 Топшириқ муддати ўзгартирилди: <b>${H.fmt(p.at)}</b>`, { parse_mode: 'HTML', ...replyTo(task) });
    await ctx.deleteMessage().catch(() => {});
});

// ---------- /reyting ----------
bot.command('reyting', async (ctx) => {
    if (!(await groupAdminOnly(ctx))) return;
    const arg = ctx.message.text.split(/\s+/)[1] || 'oy';
    const per = H.periodStart(arg);
    if (!per) return ctx.reply('Фойдаланиш: /reyting hafta | oy | hammasi');

    const tasks = Object.values(db.tasks).filter((t) => t.chatId === ctx.chat.id && (per.since === 0 || (t.createdAt || 0) >= per.since));
    if (!tasks.length) return ctx.reply(`Бу давр учун (${per.label}) топшириқ топилмади.`);

    const rows = H.computeStats(tasks).slice(0, 30);
    const medal = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => {
        const base = r.total - r.excused;
        return `${i + 1}. ${medal[i] || '▫️'} ${esc(r.name)} — ✅ ${r.onTime + r.late}/${base} (${Math.round(r.rate * 100)}%)${r.late ? ` ⏰${r.late}` : ''}${r.missed ? ` ❌${r.missed}` : ''}`;
    });
    await ctx.reply(`🏆 <b>Рейтинг — ${per.label}</b>\n(${tasks.length} та топшириқ бўйича)\n\n${lines.join('\n')}\n\n⏰ — кечикиб бажарилган, ❌ — бажарилмаган`, { parse_mode: 'HTML' });
    await ctx.deleteMessage().catch(() => {});
});

// ---------- /hisobot — Excel ----------
const statusLabel = (u) => {
    if (u.status === 'bajarildi') return u.late ? 'Кечикиб бажарди' : 'Бажарди';
    if (u.excused) return 'Узрли';
    if (u.late) return 'Кечикди';
    return u.status === 'tanishdi' ? 'Танишди' : 'Танишмади';
};

async function buildReport(ExcelJS, entries, rows) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Topshiriq bot';
    wb.created = new Date();
    const finish = (ws) => {
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    };

    const ws1 = wb.addWorksheet('Умумий');
    ws1.columns = [
        { header: '№', key: 'n', width: 5 }, { header: 'Ходим', key: 'name', width: 32 }, { header: 'Username', key: 'un', width: 24 },
        { header: 'Жами', key: 'total', width: 8 }, { header: 'Муддатида', key: 'ot', width: 11 }, { header: 'Кечикиб', key: 'late', width: 10 },
        { header: 'Бажармади', key: 'miss', width: 11 }, { header: 'Жараёнда', key: 'pend', width: 10 }, { header: 'Узрли', key: 'exc', width: 8 },
        { header: 'Бажариш %', key: 'rate', width: 11 },
    ];
    rows.forEach((r, i) => ws1.addRow({
        n: i + 1, name: r.name, un: r.username ? `@${r.username}` : '', total: r.total, ot: r.onTime, late: r.late,
        miss: r.missed, pend: r.pending, exc: r.excused, rate: Math.round(r.rate * 100),
    }));
    finish(ws1);

    const ws2 = wb.addWorksheet('Топшириқлар');
    ws2.columns = [
        { header: '№', key: 'sid', width: 6 }, { header: 'Берилган', key: 'created', width: 18 }, { header: 'Топшириқ', key: 'text', width: 60 },
        { header: 'Муддат', key: 'dl', width: 18 }, { header: 'Ҳолат', key: 'st', width: 10 }, { header: 'Жами', key: 'total', width: 8 },
        { header: 'Бажарди', key: 'done', width: 10 }, { header: 'Кечикиб', key: 'late', width: 10 }, { header: 'Бажармади', key: 'miss', width: 11 },
    ];
    const ws3 = wb.addWorksheet('Батафсил');
    ws3.columns = [
        { header: 'Топшириқ №', key: 'sid', width: 11 }, { header: 'Топшириқ', key: 'text', width: 50 }, { header: 'Ходим', key: 'name', width: 30 },
        { header: 'Ҳолат', key: 'st', width: 18 }, { header: 'Скриншот', key: 'shots', width: 10 }, { header: 'Узр сабаби', key: 'ex', width: 40 },
        { header: 'Шахсий муддат', key: 'ext', width: 18 },
    ];

    entries.sort((a, b) => a[1].sid - b[1].sid).forEach(([taskId, t]) => {
        const us = Object.keys(t.users).map((k) => [k, t.users[k]]);
        const done = us.filter(([, u]) => isDone(u));
        ws2.addRow({
            sid: t.sid, created: t.createdAt ? H.fmt(t.createdAt) : '', text: t.text, dl: t.deadlineAt ? H.fmt(t.deadlineAt) : '',
            st: t.status === 'open' ? 'Очиқ' : 'Ёпиқ', total: us.length, done: done.filter(([, u]) => !u.late).length,
            late: done.filter(([, u]) => u.late).length, miss: us.filter(([, u]) => !isDone(u) && !u.excused && (u.late || t.status !== 'open')).length,
        });
        us.forEach(([k, u]) => ws3.addRow({
            sid: t.sid, text: H.short(t.text, 80), name: u.name, st: statusLabel(u),
            shots: ((db.screenshots[taskId] || {})[k] || []).length, ex: u.excuse ? u.excuse.text : '',
            ext: u.extendedUntil ? H.fmt(u.extendedUntil) : '',
        }));
    });
    finish(ws2);
    finish(ws3);
    return wb.xlsx.writeBuffer();
}

bot.command('hisobot', async (ctx) => {
    if (!(await groupAdminOnly(ctx))) return;
    const arg = ctx.message.text.split(/\s+/)[1] || 'oy';
    const per = H.periodStart(arg);
    if (!per) return ctx.reply('Фойдаланиш: /hisobot hafta | oy | hammasi');

    let ExcelJS;
    try { ExcelJS = require('exceljs'); } catch (e) { return ctx.reply('exceljs ўрнатилмаган. Серверда: npm install exceljs'); }

    const entries = Object.keys(db.tasks)
        .filter((id) => db.tasks[id].chatId === ctx.chat.id && (per.since === 0 || (db.tasks[id].createdAt || 0) >= per.since))
        .map((id) => [id, db.tasks[id]]);
    if (!entries.length) return ctx.reply(`Бу давр учун (${per.label}) топшириқ топилмади.`);

    try {
        const buf = await buildReport(ExcelJS, entries, H.computeStats(entries.map((e) => e[1])));
        await ctx.telegram.sendDocument(ctx.from.id,
            { source: Buffer.from(buf), filename: `hisobot_${per.slug}_${H.dateKey()}.xlsx` },
            { caption: `📊 ${ctx.chat.title || 'Гуруҳ'} — ${per.label}\nТопшириқлар: ${entries.length} та` });
        await ctx.reply('📊 Ҳисобот шахсий чатингизга юборилди.');
    } catch (e) {
        console.error('Ҳисобот юборилмади:', e.description || e.message);
        await ctx.reply('Ҳисоботни юбориб бўлмади. Ботга шахсий чатда /start босинг ва қайта уриниб кўринг.');
    }
    await ctx.deleteMessage().catch(() => {});
});

// ---------- /mening — менинг топшириқларим ----------
bot.command('mening', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply('Шахсий рўйхатни кўриш учун ботга шахсий чатда /mening деб ёзинг.');
    const userId = String(ctx.from.id);
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    db.userChatIds[userId] = userId;
    if (username) db.userChatIds[username] = userId;
    writeDB();

    const items = [];
    let total = 0;
    let doneCount = 0;
    for (const tid of Object.keys(db.tasks)) {
        const t = db.tasks[tid];
        const key = matchKey(t, userId, username);
        if (!key) continue;
        const u = t.users[key];
        total++;
        if (isDone(u)) doneCount++;
        if (t.status === 'open' && !isDone(u)) items.push({ t, u, key });
    }
    if (!items.length) return ctx.reply(`✅ Ҳозирча очиқ топшириғингиз йўқ.\n📈 Жами: ${total} та топшириқдан ${doneCount} таси бажарилган.`);

    items.sort((a, b) => (userDeadline(a.t, a.u) || Infinity) - (userDeadline(b.t, b.u) || Infinity));
    const lines = items.slice(0, 20).map(({ t, u, key }, i) => {
        const dl = userDeadline(t, u);
        const link = taskLink(t);
        const title = esc(H.short(t.text, 70));
        let st = u.status === 'tanishdi' ? '🔵 Танишдим' : '🔴 Танишмадим';
        if (u.excused) st = '🟡 Узрли';
        else if (u.late) st = '⏰ Кечикди';
        const shots = u.requiredScreenshots ? ` | 📸 ${((db.screenshots[`${t.chatId}_${t.messageId}`] || {})[key] || []).length}/${u.requiredScreenshots}` : '';
        return `${i + 1}. ${link ? `<a href="${link}">${title}</a>` : title}\n    ${st}${dl ? ` | ⏳ ${H.fmt(dl)}` : ''}${shots}`;
    });
    await ctx.reply(`📋 <b>Менинг топшириқларим (${items.length} та)</b>\n\n${lines.join('\n')}\n\n📈 Жами: ${total} та топшириқдан ${doneCount} таси бажарилган.\n✉️ Узр сабабини юбориш: /sabab`, { parse_mode: 'HTML', disable_web_page_preview: true });
});

// ---------- /sabab — узр сабабини юбориш ----------
bot.command('sabab', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply('Узр сабабини ботга шахсий чатда /sabab деб юборинг.');
    const userId = String(ctx.from.id);
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    db.userChatIds[userId] = userId;
    if (username) db.userChatIds[username] = userId;
    writeDB();

    const buttons = [];
    for (const tid of Object.keys(db.tasks)) {
        const t = db.tasks[tid];
        if (t.status !== 'open') continue;
        const key = matchKey(t, userId, username);
        if (!key || isDone(t.users[key])) continue;
        buttons.push([{ text: `📌 ${H.short(t.text, 40)}`, callback_data: `sb:${t.sid}` }]);
    }
    if (!buttons.length) return ctx.reply('Ҳозирча узр сўраш мумкин бўлган очиқ топшириғингиз йўқ.');
    await ctx.reply('Қайси топшириқ бўйича узр сўрамоқчисиз?', { reply_markup: { inline_keyboard: buttons.slice(0, 20) } });
});

bot.command('bekor', (ctx) => {
    awaiting.delete(String(ctx.from.id));
    return ctx.reply('Бекор қилинди.');
});

bot.action(/^sb:(\d+)$/, async (ctx) => {
    const userId = String(ctx.from.id);
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    const task = db.tasks[findTaskId(parseInt(ctx.match[1]))];
    if (!task || task.status !== 'open') return ctx.answerCbQuery('Топшириқ топилмади ёки ёпилган.', { show_alert: true });
    if (!matchKey(task, userId, username)) return ctx.answerCbQuery('Сиз бу топшириқда йўқсиз.', { show_alert: true });

    awaiting.set(userId, { sid: task.sid, at: Date.now() });
    await ctx.answerCbQuery();
    await ctx.reply(`✍️ «${esc(H.short(task.text, 50))}» топшириғи бўйича узр сабабини битта хабар билан ёзинг (масалан: «касал эдим», «хизмат сафарида»).\nБекор қилиш: /bekor`, { parse_mode: 'HTML' });
});

// Шахсий чатда сабаб матнини қабул қилади. true қайтарса — хабар шу ерда ишлатилди.
async function handlePrivateText(ctx) {
    const userId = String(ctx.from.id);
    const st = awaiting.get(userId);
    if (!st) return false;
    if (Date.now() - st.at > 30 * 60 * 1000) { awaiting.delete(userId); return false; }
    const text = ctx.message.text;
    if (!text || text.startsWith('/')) return false;
    awaiting.delete(userId);

    const task = db.tasks[findTaskId(st.sid)];
    if (!task || task.status !== 'open') { await ctx.reply('Бу топшириқ ёпилган ёки топилмади.'); return true; }
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    const key = matchKey(task, userId, username);
    if (!key) { await ctx.reply('Сиз бу топшириқда йўқсиз.'); return true; }

    const u = task.users[key];
    if (!u.id) u.id = ctx.from.id;
    u.excuse = { text: text.slice(0, 500), at: Date.now(), status: 'pending' };
    db.userChatIds[userId] = userId;
    if (username) db.userChatIds[username] = userId;
    writeDB();

    const idx = Object.keys(task.users).indexOf(key);
    const sent = await dmAdmin(task,
        `📨 <b>Узр сўрови</b>\n👤 ${esc(u.name)}\n📝 ${esc(H.short(task.text, 100))}${task.deadlineAt ? `\n⏳ ${H.fmt(task.deadlineAt)}` : ''}\n\n💬 ${esc(u.excuse.text)}`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Узрли деб қабул қилиш', callback_data: `ex:ok:${task.sid}:${idx}` }],
                    [{ text: '📅 +1 кун', callback_data: `ex:d1:${task.sid}:${idx}` }, { text: '📅 +3 кун', callback_data: `ex:d3:${task.sid}:${idx}` }, { text: '📅 +7 кун', callback_data: `ex:d7:${task.sid}:${idx}` }],
                    [{ text: '❌ Рад этиш', callback_data: `ex:no:${task.sid}:${idx}` }],
                ],
            },
        });
    await ctx.reply(sent
        ? '✅ Сабабингиз админга юборилди. Қарор ҳақида хабар берамиз.'
        : '⚠️ Сабабингиз сақланди, лекин админга юбориб бўлмади (админ ботга шахсий чатда /start босмаган). Админга бевосита мурожаат қилинг.');
    return true;
}

// Админнинг қарори: узрли / муддат узайтириш / рад
bot.action(/^ex:(ok|d1|d3|d7|no):(\d+):(\d+)$/, async (ctx) => {
    const act = ctx.match[1];
    const taskId = findTaskId(parseInt(ctx.match[2]));
    const task = db.tasks[taskId];
    if (!task || !canManage(ctx.from.id, task)) return ctx.answerCbQuery('Рухсат йўқ ёки топшириқ топилмади.', { show_alert: true });
    const key = Object.keys(task.users)[parseInt(ctx.match[3])];
    const u = task.users[key];
    if (!u || !u.excuse) return ctx.answerCbQuery('Маълумот топилмади.', { show_alert: true });
    if (u.excuse.status !== 'pending') return ctx.answerCbQuery('Қарор аллақачон қабул қилинган.', { show_alert: true });

    let note;
    if (act === 'no') {
        u.excuse.status = 'no';
        note = '❌ Узрингиз рад этилди.';
    } else if (act === 'ok') {
        u.excuse.status = 'ok';
        u.excused = true; u.extendedUntil = null; u.late = false;
        note = '✅ Узрингиз қабул қилинди.';
    } else {
        const until = Math.max(Date.now(), task.deadlineAt || 0) + Number(act.slice(1)) * H.DAY;
        u.excuse.status = 'ok';
        u.excused = false; u.extendedUntil = until; u.late = false; u.remExt = false;
        note = `✅ Узрингиз қабул қилинди. Шахсий муддатингиз: ${H.fmt(until)}`;
    }
    writeDB();
    await refreshTaskMessage(taskId);

    await ctx.editMessageText(`${act === 'no' ? '❌ Рад этилди' : '✅ Қабул қилинди'}: ${esc(u.name)}\n📝 ${esc(H.short(task.text, 80))}`, { parse_mode: 'HTML' }).catch(() => {});
    ctx.answerCbQuery('Сақланди').catch(() => {});
    const chatId = chatIdOf(key, u);
    if (chatId) bot.telegram.sendMessage(chatId, `${note}\n📝 ${esc(H.short(task.text, 60))}`, { parse_mode: 'HTML' }).catch(() => {});
});

bot.on('message', async (ctx) => {
    const isPrivate = ctx.chat.type === 'private';

    // ---------- ЛИЧКА: скриншот қабул қилиш ----------
    if (isPrivate) {
        if (await handlePrivateText(ctx)) return; // узр сабаби кутилаётган бўлса
        if (!(ctx.message.photo || ctx.message.document)) return;

        const userId = ctx.from.id.toString();
        const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
        db.userChatIds[userId] = userId;
        if (username) db.userChatIds[username] = userId;

        const eligible = [];
        for (const tid in db.tasks) {
            const t = db.tasks[tid];
            if (t.status !== 'open' || !t.requiredScreenshots) continue;
            const key = matchKey(t, userId, username);
            if (key && t.users[key].requiredScreenshots) eligible.push({ tid, key });
        }

        if (eligible.length === 0) {
            return ctx.reply("Ҳозирча сиз учун скриншот талаб этиладиган очиқ топшириқ йўқ.");
        }

        let file;
        if (ctx.message.photo) {
            const p = ctx.message.photo[ctx.message.photo.length - 1];
            file = { fileId: p.file_id, uniqueId: p.file_unique_id, type: 'photo' };
        } else {
            const d = ctx.message.document;
            file = { fileId: d.file_id, uniqueId: d.file_unique_id, type: 'document' };
        }

        const notDone = eligible.filter((e) => db.tasks[e.tid].users[e.key].status !== 'bajarildi');
        const list = notDone.length ? notDone : eligible;

        if (list.length === 1) {
            const msg = await attachScreenshot(list[0].tid, list[0].key, file);
            return ctx.reply(msg);
        }

        pendingFiles.set(userId, file);
        const buttons = list.map((e) => {
            const t = db.tasks[e.tid];
            return [{ text: `📌 ${t.text.substring(0, 40)}`, callback_data: `pk:${t.sid}` }];
        });
        return ctx.reply("Бу скриншот қайси топшириққа тегишли?", { reply_markup: { inline_keyboard: buttons } });
    }

    // ---------- ГУРУҲ: ёзган одамни рўйхатга олиш ----------
    if (ctx.from && !ctx.message.sender_chat) await trackMember(ctx.chat.id, ctx.from);

    // ---------- ГУРУҲ: reply орқали +/- ----------
    const replyMsg = ctx.message.reply_to_message;
    const rawText = ctx.message.text || ctx.message.caption || '';

    if (replyMsg && rawText) {
        const replyText = rawText.trim();
        const isPlus = replyText.startsWith('+');
        const isMinus = replyText.startsWith('-');

        if (isPlus || isMinus) {
            if (!(await isGroupAdmin(ctx))) return;

            const taskId = `${ctx.chat.id}_${replyMsg.message_id}`;
            const task = db.tasks[taskId];

            if (task) {
                const repliedUser = replyMsg.from;
                const repliedUsername = repliedUser && repliedUser.username ? repliedUser.username.toLowerCase() : null;
                const mention = replyText.match(/@([a-zA-Z0-9_]+)/);
                const searchUsername = mention ? mention[1].toLowerCase() : repliedUsername;

                let targetKey = null;
                if (searchUsername) {
                    for (const key in task.users) {
                        const u = task.users[key];
                        if (u.username && u.username.toLowerCase() === searchUsername) { targetKey = key; break; }
                    }
                }
                if (!targetKey && repliedUser && !mention) {
                    targetKey = matchKey(task, repliedUser.id.toString(), null);
                }

                if (targetKey && task.users[targetKey]) {
                    const uObj = task.users[targetKey];
                    const prev = uObj.status;

                    if (isPlus) {
                        uObj.status = 'bajarildi';
                        if (prev !== 'bajarildi') { markLate(task, uObj); addScore(uObj.username, uObj.name, 5, 1); }
                    } else {
                        uObj.status = 'tanishmadi';
                        if (prev === 'bajarildi') addScore(uObj.username, uObj.name, -5, -1);
                        else if (prev === 'tanishdi') addScore(uObj.username, uObj.name, -1, 0);
                        if (db.screenshots[taskId]?.[targetKey]) db.screenshots[taskId][targetKey] = [];
                    }
                    writeDB();
                    await refreshTaskMessage(taskId);
                }

                await ctx.deleteMessage().catch(() => {});
                return;
            }
        }
    }

    // ---------- ГУРУҲ: янги топшириқ ----------
    const CMD_RE = /^\/(topshiriq|vazifa|skrinshot|ss)(@\w+)?(\s|$)/i;
    let text = rawText;
    let isCommand = CMD_RE.test(text);

    if (!isCommand && !text && replyMsg) {
        const rt = replyMsg.text || replyMsg.caption || '';
        if (CMD_RE.test(rt)) { isCommand = true; text = rt; }
    }
    if (!isCommand) return;

    if (!(await isGroupAdmin(ctx))) {
        await ctx.deleteMessage().catch(() => {});
        return ctx.reply("Кечирасиз, вазифани фақат гуруҳ админлари бера олади.");
    }

    let requiredScreenshots = 0;
    const ssMatch = text.match(/^\/(?:skrinshot|ss)(?:@\w+)?\s+(\d+)/i);
    if (ssMatch) {
        requiredScreenshots = parseInt(ssMatch[1]);
        text = text.replace(/^\/(?:skrinshot|ss)(?:@\w+)?\s+\d+/i, '').trim();
    } else {
        text = text.replace(/^\/(topshiriq|vazifa|skrinshot|ss)(@\w+)?/i, '').trim();
    }

    // Муддат: "25.10 18:00", "25.10.2026 18:00", "bugun 15:00", "ertaga" (вақт ёзилмаса 18:00)
    // Масъуллар: "@ali @elbek" ва/ёки "#гуруҳ" (муддатдан олдин ҳам, кейин ҳам ёзиш мумкин)
    const wanted = { handles: [], tags: [] };
    const takeTargets = () => {
        const r = H.parseTargets(text);
        wanted.handles.push(...r.handles);
        wanted.tags.push(...r.tags);
        text = r.rest;
    };
    takeTargets();

    let deadlineAt = null;
    const dlp = H.parseDeadline(text);
    if (dlp) {
        if (dlp.error) {
            return ctx.reply(dlp.error === 'past'
                ? 'Муддат ўтиб кетган. Келажакдаги сана ва вақтни киритинг. Мисол: /topshiriq 25.10 18:00 матн'
                : 'Муддат формати нотўғри. Мисол: /topshiriq 25.10 18:00 матн  ёки  /topshiriq ertaga 12:00 матн');
        }
        deadlineAt = dlp.at;
        text = dlp.rest;
        takeTargets();
    }

    let hasMedia = false;
    let targetMessageId = ctx.message.message_id;
    const hasMediaIn = (m) => m.photo || m.document || m.video || m.audio || m.voice;

    if (replyMsg) {
        targetMessageId = replyMsg.message_id;
        if (hasMediaIn(replyMsg)) hasMedia = true;
        if (!text) text = replyMsg.text || replyMsg.caption || "Бириктирилган хабар бўйича топшириқ.";
    } else if (hasMediaIn(ctx.message)) {
        hasMedia = true;
    }

    if (!text) return ctx.reply("Илтимос, вазифа матнини ҳам киритинг.");

    const adminMention = `<a href="tg://user?id=${ctx.from.id}">${esc(ctx.from.first_name)}</a>`;

    const roster = getRoster(ctx.chat.id);
    let selectedKeys = null; // null — ҳамма (рўйхатдаги барча ходимлар)
    if (wanted.handles.length || wanted.tags.length) {
        const res = resolveTargets(ctx.chat.id, wanted);
        if (res.error) return ctx.reply(res.error);
        selectedKeys = res.keys;
    }
    const taskUsers = {};
    (selectedKeys || Object.keys(roster)).forEach((k) => {
        const m = roster[k];
        taskUsers[k] = {
            name: m.name,
            username: m.username || null,
            id: m.id || null,
            status: 'tanishmadi',
            requiredScreenshots: requiredScreenshots > 0 ? requiredScreenshots : null
        };
    });

    db.counter++;
    const task = {
        sid: db.counter,
        chatId: ctx.chat.id,
        messageId: null,
        adminId: ctx.from.id,
        adminMention,
        text,
        status: 'open',
        hasMedia,
        requiredScreenshots: requiredScreenshots > 0 ? requiredScreenshots : null,
        lastReminderTime: Date.now(),
        createdAt: Date.now(),
        deadlineAt,
        deadlineReported: false,
        targeted: Boolean(selectedKeys), // фақат танланган ходимларга берилган
        // Муддатгача 24/3 соатдан кам қолган бўлса, ўша эслатмалар дарҳол юборилмайди
        reminders: { h24: !deadlineAt || deadlineAt - Date.now() <= 24 * 3600e3, h3: !deadlineAt || deadlineAt - Date.now() <= 3 * 3600e3 },
        users: taskUsers
    };

    // Vaqtinchalik id bilan matn yasaymiz, keyin haqiqiy message_id ni yozamiz
    db.tasks['tmp'] = task;
    const content = renderTaskText('tmp');
    delete db.tasks['tmp'];

    const extra = { parse_mode: 'HTML', reply_markup: taskKeyboard(task) };
    let sentMsg;
    if (hasMedia) {
        extra.caption = content;
        sentMsg = await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, targetMessageId, extra);
    } else {
        sentMsg = await ctx.reply(content, extra);
    }

    task.messageId = sentMsg.message_id;
    db.tasks[`${ctx.chat.id}_${sentMsg.message_id}`] = task;
    writeDB();

    // Эслатма ва ҳисоботлар админга шахсий чатда келади — аввал /start босилган бўлиши керак
    if (!db.userChatIds[String(ctx.from.id)]) {
        ctx.reply('ℹ️ Эслатма ва ҳисоботлар шахсий чатга келади. Топшириқ берувчи, ботга шахсий чатда /start босинг.')
            .then((m) => setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 30000))
            .catch(() => {});
    }

    await ctx.deleteMessage().catch(() => {});
    if (replyMsg) await ctx.telegram.deleteMessage(ctx.chat.id, replyMsg.message_id).catch(() => {});
});

// ==========================================
// ТУГМАЛАР: Танишдим / Ёпиш
// ==========================================
bot.action('tanishdim', async (ctx) => {
    const taskId = `${ctx.chat.id}_${ctx.callbackQuery.message.message_id}`;
    const task = db.tasks[taskId];

    if (!task) return ctx.answerCbQuery("Бу топшириқ базада топилмади.", { show_alert: true });
    if (task.status === 'closed') return ctx.answerCbQuery("Бу топшириқ ёпилган!", { show_alert: true });

    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    const name = ctx.from.first_name;

    // Танишдим босган одам доимий рўйхатга ҳам қўшилади (кейинги топшириқларда ҳам чиқади)
    if (task.targeted && !matchKey(task, userId, username)) {
        return ctx.answerCbQuery("Бу топшириқ сизга берилмаган.", { show_alert: true });
    }
    await trackMember(ctx.chat.id, ctx.from, true);

    let key = matchKey(task, userId, username);

    if (!key) {
        key = username || userId;
        task.users[key] = {
            name,
            username,
            id: ctx.from.id,
            status: task.requiredScreenshots ? 'tanishmadi' : 'tanishdi',
            requiredScreenshots: task.requiredScreenshots || null
        };
        if (task.requiredScreenshots) {
            writeDB();
            await refreshTaskMessage(taskId);
            return ctx.answerCbQuery(`Бу топшириқ учун ботга шахсий чатда ${task.requiredScreenshots} та скриншот юборишингиз керак!`, { show_alert: true });
        }
    } else {
        const u = task.users[key];
        if (u.requiredScreenshots && u.status !== 'bajarildi') {
            return ctx.answerCbQuery(`Бу топшириқ учун скриншот юборишингиз керак! (${(db.screenshots[taskId]?.[key] || []).length}/${u.requiredScreenshots})`, { show_alert: true });
        }
        if (u.status === 'bajarildi') return ctx.answerCbQuery("Сиз бу топшириқни аллақачон бажариб бўлгансиз ✅", { show_alert: true });
        if (u.status === 'tanishdi') return ctx.answerCbQuery("Сиз аллақачон танишгансиз!", { show_alert: true });
        u.status = 'tanishdi';
    }

    addScore(username, name, 1, 0);
    writeDB();
    await refreshTaskMessage(taskId);
    ctx.answerCbQuery("Топшириқ билан танишганингиз белгиланди ✅").catch(() => {});
});

bot.action('yopish', async (ctx) => {
    const taskId = `${ctx.chat.id}_${ctx.callbackQuery.message.message_id}`;
    const task = db.tasks[taskId];

    if (!task) return ctx.answerCbQuery("Топшириқ топилмади.", { show_alert: true });
    if (ctx.from.id !== task.adminId && !ADMIN_IDS.includes(String(ctx.from.id))) {
        return ctx.answerCbQuery("Топшириқни фақат уни берган админ ёпа олади!", { show_alert: true });
    }

    task.status = 'closed';
    writeDB();
    await refreshTaskMessage(taskId);
    ctx.answerCbQuery("Топшириқ ёпилди.").catch(() => {});
});

bot.catch((err, ctx) => {
    console.error(`Xato (${ctx && ctx.updateType}):`, err.message);
});

// ==========================================
// ISHGA TUSHIRISH
// ==========================================
async function initDBWithRetry(max = 5) {
    for (let i = 1; i <= max; i++) {
        try {
            await initDB();
            return;
        } catch (e) {
            console.error(`Bazaga ulanishda xato (${i}/${max}):`, e.message);
            if (i === max) throw e;
            await new Promise((r) => setTimeout(r, 3000 * i));
        }
    }
}

async function start() {
    await initDBWithRetry();

    if (USE_WEBHOOK) {
        bot.botInfo = await bot.telegram.getMe();
        markReady(); // kutib turgan yangilanishlar endi qayta ishlanadi
        await bot.telegram.setWebhook(`${SELF_URL}${HOOK_PATH}`, {
            secret_token: HOOK_SECRET,
            max_connections: 1,
            drop_pending_updates: false
        });
        console.log(`Webhook o'rnatildi: ${SELF_URL}/tg/... (@${bot.botInfo.username})`);
        console.log('Bot muvaffaqiyatli ishga tushdi (webhook)...');
    } else {
        markReady();
        bot.launch({ dropPendingUpdates: false }, () => console.log('Bot muvaffaqiyatli ishga tushdi (polling)...'))
            .catch((e) => { console.error('Bot ishga tushmadi:', e.message); process.exit(1); });
    }
}

start().catch((e) => {
    console.error('Ishga tushirishda xato:', e.message);
    process.exit(1);
});

// Har 30 daqiqada "tirikman" yozuvi: logda sukunat bo'lsa, bu haqiqiy muammo ekanini bildiradi
setInterval(() => {
    const last = lastUpdateAt ? new Date(lastUpdateAt).toISOString() : 'hali yo\'q';
    console.log(`Tirik | rejim: ${USE_WEBHOOK ? 'webhook' : 'polling'} | yangilanishlar: ${updateCount} | oxirgisi: ${last}`);
}, 30 * 60 * 1000);

process.on('unhandledRejection', (r) => console.error('unhandledRejection:', (r && r.message) || r));
process.on('uncaughtException', async (e) => {
    console.error('uncaughtException:', (e && e.message) || e);
    try { await flushNow(); } catch (err) {}
    process.exit(1); // Render o'zi qayta ishga tushiradi
});

const shutdown = async (sig) => {
    try { await flushNow(); } catch (e) { console.error(e.message); }
    try { if (!USE_WEBHOOK) bot.stop(sig); } catch (e) {}
    process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
