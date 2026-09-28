require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');

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

// Доимий фойдаланувчилар рўйхати
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
    { name: "Atabek Saburov", username: null },
    { name: "Nurbek Tajibayev", username: "nurbek_tajibayev" },
    { name: "Jasur Urazbaev", username: "jasururazbaev" },
    { name: "Nilufar Muxammedova", username: "nilufarrmuxammedova" }
];

const readDB = () => {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.tasks) parsed.tasks = {};
        if (!parsed.stats) parsed.stats = {};
        return parsed;
    } catch (error) {
        return { tasks: {}, stats: {} };
    }
};

const writeDB = (data) => {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    if (ctx.chat.type === 'private') {
        ctx.reply("Ассалому алайкум! Топшириқлар ботига уландингиз.\n\nЭнди гуруҳдаги муҳим вазифалар бўйича эслатмалар шу ерга келиб туради!");
    } else {
        ctx.reply("Ассалому алайкум! Топшириқлар ботига хуш келибсиз.");
    }
});

async function isAdmin(ctx) {
    if (ctx.chat.type === 'private') return false; 
    try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (error) {
        return false;
    }
}

// Статус матнини генерация қилиш (3 хил статус)
function generateUserList(taskUsers) {
    let userList = "";
    let count = 1;
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

        userList += `${count}. ${icon} ${u.name} (${statusText})\n`;
        count++;
    }
    return userList;
}

const addScore = (username, name, points) => {
    const db = readDB();
    const key = username ? username.toLowerCase() : name;
    if (!db.stats[key]) {
        db.stats[key] = { name: name, score: 0, completed: 0 };
    }
    db.stats[key].score += points;
    if (points > 0) db.stats[key].completed += 1;
    writeDB(db);
};

bot.on('message', async (ctx) => {
    
    // ==========================================
    // 1. БАЖАРИЛГАНЛИКНИ БЕЛГИЛАШ (+ ёки -)
    // ==========================================
    if (ctx.message.reply_to_message && ctx.message.text) {
        const replyText = ctx.message.text.trim();
        const taskId = `${ctx.chat.id}_${ctx.message.reply_to_message.message_id}`;
        const db = readDB();
        const task = db.tasks[taskId];

        if (task) {
            const isPlus = replyText.startsWith('+');
            const isMinus = replyText.startsWith('-');

            if (isPlus || isMinus) {
                const adminCheck = await isAdmin(ctx);
                if (task.status === 'closed' || !adminCheck) {
                    await ctx.deleteMessage().catch(() => {});
                    if (task.status === 'closed') {
                        const warn = await ctx.reply("❌ Бу топшириқ ёпилган, энди ўзгартириб бўлмайди!");
                        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warn.message_id).catch(() => {}), 3000);
                    }
                    return;
                }

                let targetKey = null;
                const authorId = ctx.message.reply_to_message.from.id.toString();
                const authorUsername = ctx.message.reply_to_message.from.username ? ctx.message.reply_to_message.from.username.toLowerCase() : null;

                for (const key in task.users) {
                    const u = task.users[key];
                    if (key === authorId || (authorUsername && u.username && u.username.toLowerCase() === authorUsername)) {
                        targetKey = key;
                        break;
                    }
                }

                if (!targetKey) {
                    const match = replyText.match(/^[\+-]\s*(\d+)$/);
                    if (match) {
                        const num = parseInt(match[1]);
                        const keys = Object.keys(task.users);
                        if (num > 0 && num <= keys.length) {
                            targetKey = keys[num - 1];
                        }
                    }
                }

                if (targetKey && task.users[targetKey]) {
                    const uObj = task.users[targetKey];
                    const prevStatus = uObj.status;
                    uObj.status = isPlus ? 'bajarildi' : 'tanishdi';

                    if (isPlus && prevStatus !== 'bajarildi') {
                        addScore(uObj.username, uObj.name, 5);
                    } else if (!isPlus && prevStatus === 'tanishmadi') {
                        addScore(uObj.username, uObj.name, 1);
                    }

                    writeDB(db);

                    const userList = generateUserList(task.users);
                    const newText = `📋 <b>ЯНГИ ВАЗИФА!</b>\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

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

    // ==========================================
    // 2. ЯНГИ ТОПШИРИҚ БЕРИШ (/topshiriq)
    // ==========================================
    let text = ctx.message.text || ctx.message.caption || '';
    let isCommand = text.toLowerCase().startsWith('/topshiriq') || text.toLowerCase().startsWith('/vazifa');
    
    if (!isCommand && !text && ctx.message.reply_to_message) {
        let replyText = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || '';
        if (replyText.toLowerCase().startsWith('/topshiriq') || replyText.toLowerCase().startsWith('/vazifa')) {
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

        text = text.replace(/^\/(topshiriq|vazifa)/i, '').trim();

        let hasMedia = false;
        let targetMessageId = ctx.message.message_id;

        if (ctx.message.reply_to_message) {
            targetMessageId = ctx.message.reply_to_message.message_id;
            const repMsg = ctx.message.reply_to_message;
            if (repMsg.photo || repMsg.document || repMsg.video || repMsg.audio || repMsg.voice) {
                hasMedia = true;
            }
            if (!text) {
                text = repMsg.text || repMsg.caption || "Бириктирилган хабар/файл бўйича топшириқ.";
            }
        } else {
            if (ctx.message.photo || ctx.message.document || ctx.message.video || ctx.message.audio || ctx.message.voice) {
                hasMedia = true;
            }
        }

        if (!text) return ctx.reply("Илтимос, вазифа матнини ҳам киритинг ёки файл тагига изоҳ ёзиб юборинг.");

        const safeAdminName = ctx.from.first_name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const adminMention = `<a href="tg://user?id=${ctx.from.id}">${safeAdminName}</a>`;
        const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // --- ВАҚТНИ АЖРАТИБ ОЛИШ ---
        const timeMatch = text.match(/(?:(?:muddat|муддат)\s*[:\-]?\s*)?(\d{1,2})[:\.](\d{2})/i);
        let deadlineTimestamp = null;
        let deadlineString = null;

        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const now = new Date();
            
            const deadlineDate = new Date();
            deadlineDate.setUTCHours(hours - 5, minutes, 0, 0);
            
            if (deadlineDate.getTime() <= now.getTime()) {
                deadlineDate.setDate(deadlineDate.getDate() + 1);
            }
            
            deadlineTimestamp = deadlineDate.getTime();
            deadlineString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }

        let taskUsers = {};
        DEFAULT_USERS.forEach((usr) => {
            const uniqueKey = usr.username ? usr.username.toLowerCase() : usr.name;
            taskUsers[uniqueKey] = {
                name: usr.name,
                username: usr.username,
                status: 'tanishmadi' 
            };
        });

        const userList = generateUserList(taskUsers);
        const messageContent = `📋 <b>ЯНГИ ВАЗИФА!</b>\n👤 <b>Топшириқ берувчи:</b> ${adminMention}\n\n📝 <b>Вазифа:</b> ${safeText}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

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
            deadline: deadlineTimestamp,
            deadlineString: deadlineString,
            lastReminderTime: 0,
            users: taskUsers 
        };
        writeDB(db);

        await ctx.deleteMessage().catch(() => {});
        if (ctx.message.reply_to_message) {
            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.reply_to_message.message_id).catch(() => {});
        }
    }
});

bot.action('tanishdim', async (ctx) => {
    const taskId = `${ctx.chat.id}_${ctx.callbackQuery.message.message_id}`;
    const db = readDB();
    const task = db.tasks[taskId];

    if (!task) return ctx.answerCbQuery("Бу топшириқ базада топилмади.", { show_alert: true });
    if (task.status === 'closed') return ctx.answerCbQuery("Бу топшириқ ёпилган!", { show_alert: true });

    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;
    const safeUserName = ctx.from.first_name.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let foundKey = null;
    for (const key in task.users) {
        const u = task.users[key];
        if (key === userId || (username && u.username && u.username.toLowerCase() === username)) {
            foundKey = key;
            break;
        }
    }

    if (!foundKey) {
        foundKey = username || userId;
        task.users[foundKey] = { name: safeUserName, username: username, status: 'tanishdi' };
    } else {
        if (task.users[foundKey].status === 'bajarildi') {
            return ctx.answerCbQuery("Сиз бу топшириқни аллақачон бажариб бўлгансиз ✅", { show_alert: true });
        }
        if (task.users[foundKey].status === 'tanishdi') {
            return ctx.answerCbQuery("Сиз аллақачон танишгансиз!", { show_alert: true });
        }
        task.users[foundKey].status = 'tanishdi';
        task.users[foundKey].name = safeUserName;
    }

    addScore(username, safeUserName, 1);
    writeDB(db);

    const userList = generateUserList(task.users);
    const newText = `📋 <b>ЯНГИ ВАЗИФА!</b>\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Топшириқ ҳолати:</b>\n${userList}`;

    try {
        const editOptions = {
            parse_mode: 'HTML',
            reply_markup: ctx.callbackQuery.message.reply_markup 
        };
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

    const userList = generateUserList(task.users);
    const newText = `🔒 <b>БУ ТОПШИРИҚ ЁПИЛГАН</b>\n👤 <b>Топшириқ берувчи:</b> ${task.adminMention}\n\n📝 <b>Вазифа:</b> ${task.text}\n\n<b>Якуний ҳолат:</b>\n${userList}`;

    try {
        const editOptions = {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] } 
        };
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

// ==========================================
// 3. АВТОМАТИК ЕСЛАТМА ВА ҲАФТАЛИК ЛИДЕРБОАРД ТАЙМЕРИ
// ==========================================
setInterval(() => {
    const db = readDB();
    let dbChanged = false;
    const now = Date.now();
    const HALF_HOUR = 30 * 60 * 1000;

    for (const taskId in db.tasks) {
        const task = db.tasks[taskId];
        
        if (task.status === 'open' && task.deadline) {
            if (task.deadline > now && (now - (task.lastReminderTime || 0) >= HALF_HOUR)) {
                task.lastReminderTime = now;
                dbChanged = true;
            }
        }
    }

    const currentDate = new Date();
    if (currentDate.getUTCDay() === 6 && currentDate.getUTCHours() === 13 && currentDate.getUTCMinutes() === 0) {
        const todayStr = currentDate.toISOString().split('T')[0];
        if (db.lastLeaderboardDate !== todayStr) {
            db.lastLeaderboardDate = todayStr;
            dbChanged = true;

            const statsArr = Object.values(db.stats || {});
            if (statsArr.length > 0) {
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
    }
    
    if (dbChanged) writeDB(db);
}, 60000);

bot.launch({
    dropPendingUpdates: true
}).then(() => {
    console.log("Bot muvaffaqiyatli ishga tushdi...");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));s