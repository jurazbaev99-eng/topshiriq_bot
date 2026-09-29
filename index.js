require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');
const archiver = require('archiver');

// ==========================================
// RENDER PORT TALABINI QONDIRISH (Web Service)
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running and alive!\n');
}).listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

const dbPath = path.join(__dirname, 'database.json');

// Доимий фойдаланувчилар рўйхати (15 та)
const DEFAULT_USERS = [
    { name: "Elbek Jumabekov", username: "elbek_jumabekov" },
    { name: "Makhsud Kalbayev", username: "kalbayev_makhsud_kurbonbaevich" },
    { name: "Timur Daryabayev", username: "daryabayev_timur" },
    { name: "Ali Jumamuratov", username: "ali_jumamuratov" },
    { name: "Baxodir", username: "baxodir_6694" },
    { name: "Sherzod Niyazimbetov", username: "sherzod_niyazimbetov" },
    { name: "Tilekles Mubarekov", username: "tileklesmubarekov" },
    { name: "Qurbaniyazov Qayrat", username: "qurbaniyazovqayrat" },
    { name: "Ergash Jumaniyazov", username: "jumaniyazovergash" },
    { name: "Saraykol OFY", username: "taxiyatosh_tumani_saraykol_ofy" },
    { name: "Atabek Saburov", username: "saburov_atabek", fixedKey: "atabek_saburov" },
    { name: "Nurbek Tajibayev", username: "nurbek_tajibayev" },
    { name: "Jasur Urazbaev", username: "jasururazbaev" },
    { name: "Nilufar Muxammedova", username: "nilufarrmuxammedova" },
    { name: "Atabek", username: "atabek", fixedKey: "atabek_15" }
];

const readDB = () => {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.tasks) parsed.tasks = {};
        if (!parsed.stats) parsed.stats = {};
        if (!parsed.screenshots) parsed.screenshots = {};
        if (!parsed.userChatIds) parsed.userChatIds = {};
        return parsed;
    } catch (error) {
        return { tasks: {}, stats: {}, screenshots: {}, userChatIds: {} };
    }
};

const writeDB = (data) => {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    const db = readDB();
    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;

    db.userChatIds[userId] = userId;
    if (username) db.userChatIds[username] = userId;
    writeDB(db);

    if (ctx.chat.type === 'private') {
        ctx.reply("Ассалому алайкум! Топшириқлар ботига уландингиз. Скриншотларни шу ерга юборишингиз мумкин.\n\nАдмин панели учун: /admin");
    } else {
        ctx.reply("Ассалому алайкум! Топшириқлар ботига хуш келибсиз.");
    }
});

async function isAdmin(ctx) {
    if (ctx.chat && ctx.chat.type === 'private') return true; 
    try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (error) {
        return false;
    }
}

function generateUserList(taskUsers, taskScreenshots = {}) {
    let userList = "";
    let count = 1;
    let totalScreenshots = 0;

    for (const key in taskUsers) {
        const u = taskUsers[key];
        let icon = '🔴';
        let statusText = 'Танишмади';

        if (u.status === 'bajarildi') {
            icon = '✅';
            statusText = 'Бажарди';
        } else if (u.status === 'tanishdi') {
            icon = '🔵';
            statusText = 'Танишди';
        }

        let extraInfo = ` (${statusText})`;
        if (u.requiredScreenshots) {
            const userFiles = taskScreenshots[key] || [];
            const currentCount = userFiles.length;
            totalScreenshots += currentCount;
            
            extraInfo = ` (${currentCount}/${u.requiredScreenshots})`;
            if (u.status === 'bajarildi') {
                icon = '✅';
            }
        }

        userList += `${count}. ${icon} ${u.name}${extraInfo}\n`;
        count++;
    }

    if (Object.values(taskUsers)[0]?.requiredScreenshots) {
        userList += `\n📊 <b>Умумий юборилган скриншотлар:</b> ${totalScreenshots} та`;
    }

    return userList;
}

const addScore = (username, name, points, isCompleted = false) => {
    const db = readDB();
    const key = username ? username.toLowerCase() : name;
    if (!db.stats[key]) {
        db.stats[key] = { name: name, score: 0, completed: 0 };
    }
    db.stats[key].score += points;
    if (db.stats[key].score < 0) db.stats[key].score = 0;
    if (isCompleted) {
        db.stats[key].completed += 1;
    } else if (points < 0 && db.stats[key].completed > 0) {
        db.stats[key].completed -= 1;
    }
    writeDB(db);
};

function createLeaderboardText(statsObj) {
    const statsArr = Object.values(statsObj || {});
    if (statsArr.length === 0) {
        return "📊 Ҳозирча ҳеч ким балл тўпламади.";
    }

    statsArr.sort((a, b) => b.score - a.score);

    const top3 = statsArr.slice(0, 3);
    const antiTop3 = statsArr.slice(-3).reverse();

    let report = `🏆 <b>ҲАФТАЛИК РЕЙТИНГ ЖАДВАЛИ (ТОП & АНТИ-ТОП)</b>\n\n`;
    
    report += `🥇 <b>Энг фаол ва топшириқларни бажарганлар:</b>\n`;
    top3.forEach((item, idx) => {
        report += `${idx + 1}. ${item.name} — ${item.score} балл (${item.completed} та бажарилган)\n`;
    });

    report += `\n📉 <b>Энг паст кўрсаткичга эга бўлганлар:</b>\n`;
    antiTop3.forEach((item, idx) => {
        report += `${idx + 1}. ${item.name} — ${item.score} балл\n`;
    });

    return report;
}

bot.command(['reyting', 'leaderboard', 'rating'], async (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply("Бу буйруқ фақат гуруҳларда ишлайди.");
    const adminCheck = await isAdmin(ctx);
    if (!adminCheck) return ctx.reply("Кечирасиз, рейтингни фақат гуруҳ админлари чақира олади.");

    const db = readDB();
    const report = createLeaderboardText(db.stats);
    await ctx.reply(report, { parse_mode: 'HTML' });
});

bot.command('admin', async (ctx) => {
    if (ctx.chat.type !== 'private') return ctx.reply("Бу буйруқ фақат ботнинг шахсий чатида (личкада) ишлайди.");

    const db = readDB();
    const openTasks = Object.keys(db.tasks).filter(tid => db.tasks[tid].status === 'open');

    if (openTasks.length === 0) {
        return ctx.reply("Ҳозирча гуруҳларда очиқ топшириқлар мавжуд эмас.");
    }

    let buttons = [];
    openTasks.forEach(tid => {
        const t = db.tasks[tid];
        buttons.push([{ text: `📌 ${t.text.substring(0, 30)}...`, callback_data: `adm_task_${tid}` }]);
    });

    await ctx.reply("Админ панель: Текширмоқчи бўлган топшириқни танланг:", {
        reply_markup: { inline_keyboard: buttons }
    });
});

bot.action(/^adm_task_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const db = readDB();
    const task = db.tasks[taskId];

    if (!task) return ctx.answerCbQuery("Топшириқ топилмади.", { show_alert: true });

    let buttons = [];
    for (const uKey in task.users) {
        const u = task.users[uKey];
        const count = (db.screenshots[taskId]?.[uKey] || []).length;
        buttons.push([{ text: `👤 ${u.name} (${count} та скриншот)`, callback_data: `adm_user_${taskId}_${uKey}` }]);
    }

    await ctx.editMessageText(`📌 <b>Топшириқ:</b> ${task.text}\n\nИштирокчилардан бирини танланг:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
    });
});

bot.action(/^adm_user_(.+)_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const userKey = ctx.match[2];
    const db = readDB();
    const task = db.tasks[taskId];
    const userFiles = db.screenshots[taskId]?.[userKey] || [];
    const uObj = task.users[userKey];

    if (userFiles.length === 0) {
        return ctx.answerCbQuery("Бу фойдаланувчи ҳали скриншот юбормаган.", { show_alert: true });
    }

    await ctx.reply(`👤 <b>${uObj.name}</b> томонидан юборилган скриншотлар (${userFiles.length} та):\n\nҲаммасини папка қилиб юклаб олиш ёки янгиларини кўриш учун қуйидаги тугмаларни босинг:`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📦 Блоклаб (ZIP) архив қилиб юклаб олиш", callback_data: `zip_${taskId}_${userKey}` }],
                [{ text: "👁 Фақат янги/қўшимча расмларни кўриш", callback_data: `new_ss_${taskId}_${userKey}` }]
            ]
        }
    });
});

bot.action(/^zip_(.+)_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const userKey = ctx.match[2];
    const db = readDB();
    const userFiles = db.screenshots[taskId]?.[userKey] || [];

    if (userFiles.length === 0) return ctx.answerCbQuery("Расмлар топилмади.", { show_alert: true });

    await ctx.answerCbQuery("📦 Архив тайёрланмоқда, илтимос кутиб туринг...");

    try {
        const archivePath = path.join(__dirname, `screenshots_${userKey}.zip`);
        const output = fs.createWriteStream(archivePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.pipe(output);

        for (let i = 0; i < userFiles.length; i++) {
            const fileId = userFiles[i];
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const response = await fetch(fileLink.href);
            const buffer = Buffer.from(await response.arrayBuffer());
            archive.append(buffer, { name: `screenshot_${i + 1}.jpg` });
        }

        await archive.finalize();

        await ctx.replyWithDocument({ source: archivePath, filename: `screenshots_${userKey}.zip` });
        
        setTimeout(() => {
            if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
        }, 10000);

    } catch (err) {
        ctx.reply("❌ Архив қилишда хатолик юз берди.");
    }
});

bot.action(/^new_ss_(.+)_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const userKey = ctx.match[2];
    const db = readDB();
    const userFiles = db.screenshots[taskId]?.[userKey] || [];
    
    if (!db.checkedIndex) db.checkedIndex = {};
    if (!db.checkedIndex[taskId]) db.checkedIndex[taskId] = {};
    let lastChecked = db.checkedIndex[taskId][userKey] || 0;

    if (lastChecked >= userFiles.length) {
        return ctx.answerCbQuery("Ҳозирча янги қўшилган скриншотлар қолмади (ҳаммаси кўриб чиқилган).", { show_alert: true });
    }

    await ctx.reply(`🔍 Янги қўшилган скриншотлар (${lastChecked + 1} дан ${userFiles.length} гача):`);

    for (let i = lastChecked; i < userFiles.length; i++) {
        const fileId = userFiles[i];
        await ctx.replyWithPhoto(fileId, {
            caption: `Расм #${i + 1}`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "❌ Ушбу расмни рад этиш ва ўчириш", callback_data: `del_ss_${taskId}_${userKey}_${i}` }]
                ]
            }
        });
    }

    db.checkedIndex[taskId][userKey] = userFiles.length;
    writeDB(db);
});

bot.action(/^del_ss_(.+)_(.+)_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const userKey = ctx.match[2];
    const index = parseInt(ctx.match[3]);

    const db = readDB();
    const task = db.tasks[taskId];
    if (!task || !task.users[userKey]) return ctx.answerCbQuery("Маълумот топилмади.", { show_alert: true });

    const uObj = task.users[userKey];
    let userFiles = db.screenshots[taskId]?.[userKey] || [];

    if (index >= 0 && index < userFiles.length) {
        userFiles.splice(index, 1);
        db.screenshots[taskId][userKey] = userFiles;

        if (db.checkedIndex?.[taskId]?.[userKey]) {
            db.checkedIndex[taskId][userKey] = userFiles.length;
        }

        if (uObj.requiredScreenshots && userFiles.length < uObj.requiredScreenshots) {
            if (uObj.status === 'bajarildi') {
                uObj.status = 'tanishdi';
                addScore(uObj.username, uObj.name, -5, false);
            }
        }

        writeDB(db);

        const userList = generateUserList(task.users, db.screenshots[taskId]);
        let reqCount = uObj.requiredScreenshots;
        let headerTitle = reqCount ? `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${reqCount} та)!</b>` : `📋 <b>ЯНГИ ВАЗИФА!</b>`;
        const newText = `${headerTitle}\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

        try {
            const editOptions = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "👁 Танишдим", callback_data: "tanishdim" }], [{ text: "🔒 Топшириқни ёпиш", callback_data: "yopish" }]] } };
            if (task.hasMedia) {
                await ctx.telegram.editMessageCaption(task.chatId, parseInt(taskId.split('_')[1]), undefined, newText, editOptions);
            } else {
                await ctx.telegram.editMessageText(task.chatId, parseInt(taskId.split('_')[1]), undefined, newText, editOptions);
            }
        } catch (err) {}

        await ctx.answerCbQuery("✅ Танланган расм ўчирилди ва ҳисоб янгиланди!", { show_alert: true });
        await ctx.editMessageCaption("❌ Ушбу расм рад этилиб, ўчириб ташланди.").catch(() => {});
    } else {
        await ctx.answerCbQuery("Хатолик: расм топилмади.", { show_alert: true });
    }
});

bot.on('message', async (ctx) => {
    if (ctx.from) {
        const db = readDB();
        const userId = ctx.from.id.toString();
        const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
        if (!db.userChatIds) db.userChatIds = {};
        db.userChatIds[userId] = userId;
        if (username) db.userChatIds[username] = userId;
        writeDB(db);
    }

    const isPrivate = ctx.chat.type === 'private';

    if (isPrivate) {
        if (ctx.message.photo || ctx.message.document) {
            const db = readDB();
            let targetTaskId = null;
            let targetUserKey = null;

            const userId = ctx.from.id.toString();
            const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;

            for (const tid in db.tasks) {
                const t = db.tasks[tid];
                if (t.status === 'open') {
                    for (const uKey in t.users) {
                        const u = t.users[uKey];
                        if ((uKey === userId || (username && u.username && u.username.toLowerCase() === username)) && u.requiredScreenshots) {
                            targetTaskId = tid;
                            targetUserKey = uKey;
                            break;
                        }
                    }
                }
                if (targetTaskId) break;
            }

            if (!targetTaskId) {
                return ctx.reply("Ҳозирча сиз учун скриншот талаб этиладиган очиқ топшириқ йўқ.");
            }

            const task = db.tasks[targetTaskId];
            const uObj = task.users[targetUserKey];

            if (!db.screenshots[targetTaskId]) db.screenshots[targetTaskId] = {};
            if (!db.screenshots[targetTaskId][targetUserKey]) db.screenshots[targetTaskId][targetUserKey] = [];

            const fileId = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.document.file_id;
            db.screenshots[targetTaskId][targetUserKey].push(fileId);

            const currentCount = db.screenshots[targetTaskId][targetUserKey].length;
            const required = uObj.requiredScreenshots;

            if (currentCount >= required && uObj.status !== 'bajarildi') {
                uObj.status = 'bajarildi';
                addScore(uObj.username, uObj.name, 5, true);
            }

            writeDB(db);

            const userList = generateUserList(task.users, db.screenshots[targetTaskId]);
            let headerTitle = `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${required} та)!</b>`;
            const newText = `${headerTitle}\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

            try {
                const editOptions = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "👁 Танишдим", callback_data: "tanishdim" }], [{ text: "🔒 Топшириқни ёпиш", callback_data: "yopish" }]] } };
                if (task.hasMedia) {
                    await ctx.telegram.editMessageCaption(task.chatId, parseInt(targetTaskId.split('_')[1]), undefined, newText, editOptions);
                } else {
                    await ctx.telegram.editMessageText(task.chatId, parseInt(targetTaskId.split('_')[1]), undefined, newText, editOptions);
                }
            } catch (err) {}

            return ctx.reply(`✅ Скриншот қабул қилинди! (${currentCount}/${required})`);
        }
        return;
    }

    // 1. Эски топшириқни қайта ташлаш (/qayta)
    if (ctx.message.reply_to_message && ctx.message.text) {
        const textLower = ctx.message.text.trim().toLowerCase();
        if (textLower.startsWith('/qayta') || textLower.startsWith('/yangilash')) {
            const adminCheck = await isAdmin(ctx);
            if (!adminCheck) {
                await ctx.deleteMessage().catch(() => {});
                return ctx.reply("Кечирасиз, буни фақат админлар қила олади.");
            }

            const oldTaskId = `${ctx.chat.id}_${ctx.message.reply_to_message.message_id}`;
            const db = readDB();
            const oldTask = db.tasks[oldTaskId];

            if (!oldTask) {
                await ctx.deleteMessage().catch(() => {});
                return ctx.reply("❌ Бу эски топшириқ базада топилмади.");
            }

            const userList = generateUserList(oldTask.users, db.screenshots[oldTaskId]);
            let reqCount = Object.values(oldTask.users)[0]?.requiredScreenshots;
            let headerTitle = reqCount ? `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${reqCount} та)!</b>` : `📋 <b>ЯНГИ ВАЗИФА!</b>`;
            const messageContent = `${headerTitle}\n👤 <b>Топшириқ берувчи:</b> ${oldTask.adminMention}\n\n📝 <b>Вазифа:</b> ${oldTask.text}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

            const extraOptions = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "👁 Танишдим", callback_data: "tanishdim" }],
                        [{ text: "🔒 Топшириқни ёпиш", callback_data: "yopish" }]
                    ]
                }
            };

            let sentMsg;
            if (oldTask.hasMedia) {
                extraOptions.caption = messageContent;
                sentMsg = await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, ctx.message.reply_to_message.message_id, extraOptions);
            } else {
                sentMsg = await ctx.reply(messageContent, extraOptions);
            }

            const newTaskId = `${ctx.chat.id}_${sentMsg.message_id}`;
            db.tasks[newTaskId] = { ...oldTask, chatId: ctx.chat.id };
            if (db.screenshots[oldTaskId]) {
                db.screenshots[newTaskId] = db.screenshots[oldTaskId];
                delete db.screenshots[oldTaskId];
            }
            writeDB(db);

            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.reply_to_message.message_id).catch(() => {});
            delete db.tasks[oldTaskId];
            writeDB(db);

            await ctx.deleteMessage().catch(() => {});
            return;
        }
    }

    // 2. БАЖАРИЛГАНЛИКНИ БЕЛГИЛАШ ЁКИ БЕКОР ҚИЛИШ (+ / - орқали) - ФАҚАТ АДМИНЛАР УЧУН!
    if (ctx.message.reply_to_message && (ctx.message.text || ctx.message.caption)) {
        const replyText = (ctx.message.text || ctx.message.caption || '').trim();
        const taskId = `${ctx.chat.id}_${ctx.message.reply_to_message.message_id}`;
        const db = readDB();
        let task = db.tasks[taskId];

        if (task) {
            const isPlus = replyText.startsWith('+');
            const isMinus = replyText.startsWith('-');

            if (isPlus || isMinus) {
                const adminCheck = await isAdmin(ctx);
                if (!adminCheck) {
                    await ctx.deleteMessage().catch(() => {});
                    return;
                }

                let targetKey = null;
                let searchUsername = null;

                // А) Текст ичидаги @username ни топиш
                const mentionMatch = replyText.match(/@([a-zA-Z0-9_]+)/);
                if (mentionMatch) {
                    searchUsername = mentionMatch[1].toLowerCase();
                }

                // Б) Текста entity (mention ёки text_link) орқали уланган @username ёки user_id ни топиш
                if (!searchUsername && ctx.message.entities) {
                    for (const entity of ctx.message.entities) {
                        if (entity.type === 'text_mention' && entity.user) {
                            const targetUserId = entity.user.id.toString();
                            if (task.users[targetUserId]) {
                                targetKey = targetUserId;
                                break;
                            }
                            if (entity.user.username) {
                                searchUsername = entity.user.username.toLowerCase();
                            }
                        }
                    }
                }

                // В) Умумий базадан username бўйича қидириш
                if (searchUsername) {
                    for (const key in task.users) {
                        const u = task.users[key];
                        if (u.username && u.username.toLowerCase() === searchUsername) {
                            targetKey = key;
                            break;
                        }
                    }
                }

                // Г) Рақам орқали қидириш (масалан: +15)
                if (!targetKey) {
                    const numMatch = replyText.match(/^[\+-]\s*(\d+)$/);
                    if (numMatch) {
                        const num = parseInt(numMatch[1]);
                        const keys = Object.keys(task.users);
                        if (num > 0 && num <= keys.length) {
                            targetKey = keys[num - 1];
                        }
                    }
                }

                if (targetKey && task.users[targetKey]) {
                    const uObj = task.users[targetKey];
                    const prevStatus = uObj.status;

                    if (isPlus) {
                        uObj.status = 'bajarildi';
                        if (prevStatus !== 'bajarildi') addScore(uObj.username, uObj.name, 5, true);
                    } else {
                        uObj.status = 'tanishmadi';
                        if (prevStatus === 'bajarildi') addScore(uObj.username, uObj.name, -5, false);
                        if (db.screenshots[taskId]?.[targetKey]) db.screenshots[taskId][targetKey] = [];
                    }

                    writeDB(db);

                    const userList = generateUserList(task.users, db.screenshots[taskId]);
                    let reqCount = Object.values(task.users)[0]?.requiredScreenshots;
                    let headerTitle = reqCount ? `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${reqCount} та)!</b>` : `📋 <b>ЯНГИ ВАЗИФА!</b>`;
                    const newText = `${headerTitle}\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

                    const editOptions = {
                        parse_mode: 'HTML',
                        reply_markup: ctx.message.reply_to_message.reply_markup 
                    };

                    try {
                        if (task.hasMedia) {
                            await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.message.reply_to_message.message_id, undefined, newText, editOptions);
                        } else {
                            await ctx.telegram.editMessageText(ctx.chat.id, ctx.message.reply_to_message.message_id, undefined, newText, editOptions);
                        }
                    } catch (err) {}
                }
                
                await ctx.deleteMessage().catch(() => {});
                return; 
            }
        }
    }

    // 3. ЯНГИ ТОПШИРИҚ БЕРИШ (/topshiriq ёки /skrinshot [сони])
    let text = ctx.message.text || ctx.message.caption || '';
    let isCommand = text.toLowerCase().startsWith('/topshiriq') || text.toLowerCase().startsWith('/vazifa') || text.toLowerCase().startsWith('/skrinshot') || text.toLowerCase().startsWith('/ss');
    
    if (!isCommand && !text && ctx.message.reply_to_message) {
        let replyText = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || '';
        if (replyText.toLowerCase().startsWith('/topshiriq') || replyText.toLowerCase().startsWith('/vazifa') || replyText.toLowerCase().startsWith('/skrinshot')) {
            isCommand = true;
            text = replyText;
        }
    }

    if (isCommand) {
        if (ctx.chat.type === 'private') return ctx.reply("Бу команда фақат гуруҳларда ишлайди.");
        
        const adminCheck = await isAdmin(ctx);
        if (!adminCheck) {
            await ctx.deleteMessage().catch(() => {});
            return ctx.reply("Кечирасиз, вазифани фақат гуруҳ админлари бера олади.");
        }

        let requiredScreenshots = 0;
        const ssMatch = text.match(/^\/(?:skrinshot|ss)\s+(\d+)/i);
        if (ssMatch) {
            requiredScreenshots = parseInt(ssMatch[1]);
            text = text.replace(/^\/(?:skrinshot|ss)\s+\d+/i, '').trim();
        } else {
            text = text.replace(/^\/(topshiriq|vazifa|skrinshot|ss)/i, '').trim();
        }

        let hasMedia = false;
        let targetMessageId = ctx.message.message_id;

        if (ctx.message.reply_to_message) {
            targetMessageId = ctx.message.reply_to_message.message_id;
            const repMsg = ctx.message.reply_to_message;
            if (repMsg.photo || repMsg.document || repMsg.video || repMsg.audio || repMsg.voice) {
                hasMedia = true;
            }
            if (!text) {
                text = repMsg.text || repMsg.caption || "Бириктирилган хабар бўйича топшириқ.";
            }
        } else {
            if (ctx.message.photo || ctx.message.document || ctx.message.video || ctx.message.audio || ctx.message.voice) {
                hasMedia = true;
            }
        }

        if (!text) return ctx.reply("Илтимос, вазифа матнини ҳам киритинг.");

        const safeAdminName = ctx.from.first_name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const adminMention = `<a href="tg://user?id=${ctx.from.id}">${safeAdminName}</a>`;
        const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        let taskUsers = {};
        DEFAULT_USERS.forEach((usr) => {
            const uniqueKey = usr.fixedKey || (usr.username ? usr.username.toLowerCase() : usr.name);
            taskUsers[uniqueKey] = {
                name: usr.name,
                username: usr.username,
                status: 'tanishmadi',
                requiredScreenshots: requiredScreenshots > 0 ? requiredScreenshots : null
            };
        });

        const userList = generateUserList(taskUsers);
        let headerTitle = requiredScreenshots > 0 ? `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${requiredScreenshots} та)!</b>` : `📋 <b>ЯНГИ ВАЗИФА!</b>`;
        const messageContent = `${headerTitle}\n👤 <b>Топшириқ берувчи:</b> ${adminMention}\n\n📝 <b>Вазифа:</b> ${safeText}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

        let sentMsg;
        const extraOptions = {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "👁 Танишдим", callback_data: "tanishdim" }],
                    [{ text: "🔒 Топшириқни ёпиш", callback_data: "yopish" }]
                ]
            }
        };

        if (hasMedia) {
            extraOptions.caption = messageContent;
            sentMsg = await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, targetMessageId, extraOptions);
        } else {
            sentMsg = await ctx.reply(messageContent, extraOptions);
        }

        const db = readDB();
        const taskId = `${ctx.chat.id}_${sentMsg.message_id}`;
        db.tasks[taskId] = {
            chatId: ctx.chat.id,
            adminId: ctx.from.id,
            adminMention: adminMention,
            text: safeText,
            status: 'open',
            hasMedia: hasMedia,
            lastReminderTime: Date.now(),
            users: taskUsers 
        };
        writeDB(db);

        await ctx.deleteMessage().catch(() => {});
        if (ctx.message.reply_to_message) {
            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.reply_to_message.message_id).catch(() => {});
        }
    }
});

// "Танишдим" тугмаси босилганда
bot.action('tanishdim', async (ctx) => {
    const taskId = `${ctx.chat.id}_${ctx.callbackQuery.message.message_id}`;
    const db = readDB();
    let task = db.tasks[taskId];

    if (!task) return ctx.answerCbQuery("Бу топшириқ базада топилмади.", { show_alert: true });
    if (task.status === 'closed') return ctx.answerCbQuery("Бу топшириқ ёпилган!", { show_alert: true });

    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    const userFirstName = ctx.from.first_name.toLowerCase();
    const safeUserName = ctx.from.first_name.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let foundKey = null;
    for (const key in task.users) {
        const u = task.users[key];
        if (key === userId || (username && u.username && u.username.toLowerCase() === username) || u.name.toLowerCase().includes(userFirstName)) {
            foundKey = key;
            break;
        }
    }

    if (!foundKey) {
        foundKey = username || userId;
        task.users[foundKey] = { name: safeUserName, username: username, status: 'tanishdi' };
    } else {
        if (task.users[foundKey].requiredScreenshots && task.users[foundKey].status !== 'bajarildi') {
            return ctx.answerCbQuery(`Бу топшириқ учун скриншот юборишингиз керак! (${(db.screenshots[taskId]?.[foundKey] || []).length}/${task.users[foundKey].requiredScreenshots})`, { show_alert: true });
        }
        if (task.users[foundKey].status === 'bajarildi') {
            return ctx.answerCbQuery("Сиз бу топшириқни аллақачон бажариб бўлгансиз ✅", { show_alert: true });
        }
        if (task.users[foundKey].status === 'tanishdi') {
            return ctx.answerCbQuery("Сиз аллақачон танишгансиз!", { show_alert: true });
        }
        task.users[foundKey].status = 'tanishdi';
        task.users[foundKey].name = safeUserName;
    }

    addScore(username, safeUserName, 1, false);
    writeDB(db);

    const userList = generateUserList(task.users, db.screenshots[taskId]);
    let reqCount = Object.values(task.users)[0]?.requiredScreenshots;
    let headerTitle = reqCount ? `📋 <b>ЯНГИ ВАЗИФА (Скриншот талаб этилади: ${reqCount} та)!</b>` : `📋 <b>ЯНГИ ВАЗИФА!</b>`;
    const newText = `${headerTitle}\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

    try {
        const editOptions = { parse_mode: 'HTML', reply_markup: ctx.callbackQuery.message.reply_markup };
        if (task.hasMedia) {
            await ctx.editMessageCaption(newText, editOptions);
        } else {
            await ctx.editMessageText(newText, editOptions);
        }
        ctx.answerCbQuery("Топшириқ билан танишганингиз белгиланди ✅");
    } catch (err) {
        ctx.answerCbQuery("Хатолик юз берди.");
    }
});

bot.action('yopish', async (ctx) => {
    const taskId = `${ctx.chat.id}_${ctx.callbackQuery.message.message_id}`;
    const db = readDB();
    const task = db.tasks[taskId];

    if (!task) return ctx.answerCbQuery("Топшириқ топилмади.", { show_alert: true });
    if (ctx.from.id !== task.adminId) return ctx.answerCbQuery("Топшириқни фақат уни берган админ ёпа олади!", { show_alert: true });

    task.status = 'closed';
    writeDB(db);

    const userList = generateUserList(task.users, db.screenshots[taskId]);
    const newText = `🔒 <b>БУ ТОПШИРИҚ ЁПИЛГАН</b>\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Якуний ҳолат:</b>\n${userList}`;

    try {
        const editOptions = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } };
        if (task.hasMedia) {
            await ctx.editMessageCaption(newText, editOptions);
        } else {
            await ctx.editMessageText(newText, editOptions);
        }
        ctx.answerCbQuery("Топшириқ ёпилди.");
    } catch (err) {
        ctx.answerCbQuery("Хатолик юз берди.");
    }
});

setInterval(async () => {
    const db = readDB();
    let dbChanged = false;
    const now = Date.now();

    for (const tid in db.tasks) {
        const task = db.tasks[tid];
        if (task.status === 'open') {
            if (!task.lastReminderTime || (now - task.lastReminderTime >= 30 * 60 * 1000)) {
                task.lastReminderTime = now;
                dbChanged = true;

                for (const uKey in task.users) {
                    const u = task.users[uKey];
                    if (u.status !== 'bajarildi') {
                        const userChatId = db.userChatIds?.[uKey] || (u.username ? db.userChatIds[u.username.toLowerCase()] : null);
                        if (userChatId) {
                            const reminderText = `⚠️️ <b>Эслатма!</b>\nСиз қуйидаги топшириқни ҳали бажармадингиз:\n\n📝 <b>Вазифа:</b> ${task.text}\n\nИлтимос, вазифани ўз вақтида бажаринг!`;
                            await bot.telegram.sendMessage(userChatId, reminderText, { parse_mode: 'HTML' }).catch(() => {});
                        }
                    }
                }
            }
        }
    }

    const currentDate = new Date();
    if (currentDate.getUTCDay() === 6 && currentDate.getUTCHours() === 13 && currentDate.getUTCMinutes() === 0) {
        const todayStr = currentDate.toISOString().split('T')[0];
        if (db.lastLeaderboardDate !== todayStr) {
            db.lastLeaderboardDate = todayStr;
            dbChanged = true;

            const report = createLeaderboardText(db.stats);
            const chatIds = new Set();
            for (const tid in db.tasks) {
                if (db.tasks[tid].chatId) chatIds.add(db.tasks[tid].chatId);
            }

            chatIds.forEach(chatId => {
                bot.telegram.sendMessage(chatId, report, { parse_mode: 'HTML' }).catch(() => {});
            });

            db.stats = {};
        }
    }
    
    if (dbChanged) writeDB(db);
}, 60000);

bot.launch({ dropPendingUpdates: true }).then(() => {
    console.log("Bot muvaffaqiyatli ishga tushdi...");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));