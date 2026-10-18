require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==========================================
// SOZLAMALAR
// ==========================================
const PORT = process.env.PORT || 3000;
// Render avtomatik RENDER_EXTERNAL_URL beradi (masalan https://mening-botim.onrender.com)
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || '';
// Admin Telegram ID lari, vergul bilan: ADMIN_IDS=12345,67890
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

// ==========================================
// HTTP SERVER + O'ZINI UYG'OTIB TURISH (Render bepul tarif uchun)
// ==========================================
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running and alive!\n');
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
const dbPath = path.join(__dirname, 'database.json');
let db = { tasks: {}, stats: {}, screenshots: {}, userChatIds: {}, counter: 0 };
let col = null; // MongoDB collection (MONGODB_URI bo'lsa)

function normalizeDB() {
    ['tasks', 'stats', 'screenshots', 'userChatIds'].forEach((k) => { if (!db[k]) db[k] = {}; });
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
    if (process.env.MONGODB_URI) {
        const { MongoClient } = require('mongodb');
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        col = client.db(process.env.MONGODB_DB || 'topshiriq_bot').collection('state');
        const doc = await col.findOne({ _id: 'main' });
        if (doc) {
            const { _id, ...rest } = doc;
            db = { ...db, ...rest };
        }
        console.log('MongoDB ulandi.');
    } else {
        console.warn('DIQQAT: MONGODB_URI yo\'q. Ma\'lumotlar faylga yoziladi va Render\'da qayta ishga tushganda yo\'qoladi!');
        try {
            if (fs.existsSync(dbPath)) db = { ...db, ...JSON.parse(fs.readFileSync(dbPath, 'utf8')) };
        } catch (e) {
            console.error('database.json o\'qilmadi:', e.message);
        }
    }
    normalizeDB();
}

let flushTimer = null;
let flushing = Promise.resolve();

async function persist() {
    if (col) {
        await col.replaceOne({ _id: 'main' }, { _id: 'main', ...db }, { upsert: true });
    } else {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
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
        if (username && u.username && u.username.toLowerCase() === username) return key;
    }
    return null;
}

function isBotAdmin(userId) {
    const id = String(userId);
    if (ADMIN_IDS.includes(id)) return true;
    return Object.values(db.tasks).some((t) => String(t.adminId) === id);
}

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
    const botName = bot.botInfo && bot.botInfo.username;

    const build = (txt) => {
        if (task.status === 'closed') {
            return `🔒 <b>БУ ТОПШИРИҚ ЁПИЛГАН</b>\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${esc(txt)}\n\n<b>Якуний ҳолат:</b>\n${list}`;
        }
        const header = req
            ? `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${req} та)!</b>`
            : `📋 <b>ЯНГИ ВАЗИФА!</b>`;
        const hint = req && botName ? `\n\n📩 Скриншотни @${botName} га шахсий чатда юборинг (аввал /start босинг).` : '';
        return `${header}\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${esc(txt)}\n\n<b>Топшириқ ҳолати:</b>\n${list}${hint}`;
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
    arr.push(file);

    const required = u.requiredScreenshots;
    if (arr.length >= required && u.status !== 'bajarildi') {
        u.status = 'bajarildi';
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
        ctx.reply("Ассалому алайкум! Топшириқлар ботига уландингиз. Скриншотларни шу ерга юборишингиз мумкин.\n\nАдмин панели учун: /admin");
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

    const openTasks = Object.keys(db.tasks).filter((tid) => db.tasks[tid].status === 'open');
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
    if (!task) return ctx.answerCbQuery("Топшириқ топилмади.", { show_alert: true });

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
    if (!task) return ctx.answerCbQuery("Топшириқ топилмади.", { show_alert: true });

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
    if (!task) return ctx.answerCbQuery("Маълумот топилмади.", { show_alert: true });

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
// ХАБАРЛАР
// ==========================================
bot.on('message', async (ctx) => {
    const isPrivate = ctx.chat.type === 'private';

    // ---------- ЛИЧКА: скриншот қабул қилиш ----------
    if (isPrivate) {
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
                        if (prev !== 'bajarildi') addScore(uObj.username, uObj.name, 5, 1);
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

    const taskUsers = {};
    DEFAULT_USERS.forEach((usr) => {
        taskUsers[usr.fixedKey] = {
            name: usr.name,
            username: usr.username,
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

    let key = matchKey(task, userId, username);

    if (!key) {
        key = username || userId;
        task.users[key] = {
            name,
            username,
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
(async () => {
    await initDB();
    bot.launch({ dropPendingUpdates: false }, () => console.log('Bot muvaffaqiyatli ishga tushdi...'))
        .catch((e) => { console.error('Bot ishga tushmadi:', e.message); process.exit(1); });
})();

const shutdown = async (sig) => {
    try { await flushNow(); } catch (e) { console.error(e.message); }
    try { bot.stop(sig); } catch (e) {}
    process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
