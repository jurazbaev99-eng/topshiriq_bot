require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');
const archiver = require('archiver');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running and alive!\n');
}).listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

const dbPath = path.join(__dirname, 'database.json');

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

    // 1. ТОПШИРИҚҚА REPLY ҚИЛИБ '+' ЁКИ '-' ЁЗГАНДА ҲОЛАТНИ ЎЗГАРТИРИШ
    if (ctx.message.reply_to_message && (ctx.message.text || ctx.message.caption)) {
        const replyText = (ctx.message.text || ctx.message.caption || '').trim();
        const isPlus = replyText.startsWith('+');
        const isMinus = replyText.startsWith('-');

        if (isPlus || isMinus) {
            const adminCheck = await isAdmin(ctx);
            if (!adminCheck) {
                return; // Админ бўлмаса ҳеч нарса қилмайди
            }

            // Айнан ўша реплай қилинган хабарнинг ID си орқали топшириқни топамизки, бу бир нечта топшириқ бўлганда ҳам адашмайди
            const taskId = `${ctx.chat.id}_${ctx.message.reply_to_message.message_id}`;
            const db = readDB();
            let task = db.tasks[taskId];

            if (task) {
                let targetKey = null;
                const repliedUser = ctx.message.reply_to_message.from;
                const repliedUsername = repliedUser && repliedUser.username ? repliedUser.username.toLowerCase() : null;

                // Хабар эгасининг username ёки исми бўйича базадан топамизки, бу 100% аниқ ишлайди
                const mentionMatch = replyText.match(/@([a-zA-Z0-9_]+)/);
                let searchUsername = mentionMatch ? mentionMatch[1].toLowerCase() : repliedUsername;

                if (searchUsername) {
                    for (const key in task.users) {
                        const u = task.users[key];
                        if (u.username && u.username.toLowerCase() === searchUsername) {
                            targetKey = key;
                            break;
                        }
                    }
                }

                if (!targetKey && repliedUser) {
                    // Агар username бўлмаса, исми ёки ID си бўйича текширамиз
                    for (const key in task.users) {
                        const u = task.users[key];
                        if (key === repliedUser.id.toString() || u.name.toLowerCase().includes(repliedUser.first_name.toLowerCase())) {
                            targetKey = key;
                            break;
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

                    try {
                        const editOptions = {
                            parse_mode: 'HTML',
                            reply_markup: ctx.message.reply_to_message.reply_markup 
                        };
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

    // 2. ЯНГИ ТОПШИРИҚ БЕРИШ
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

bot.launch({ dropPendingUpdates: true }).then(() => {
    console.log("Bot muvaffaqiyatli ishga tushdi...");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));