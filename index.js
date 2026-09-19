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

const readDB = () => {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { tasks: {} };
    }
};

const writeDB = (data) => {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    if (ctx.chat.type === 'private') {
        ctx.reply("Ассалому алайкум! Топшириқлар ботига уландингиз.\n\nЭнди гуруҳдаги муҳим вазифалар муддати тугашига 1 соат қолганда мен сизга шу ерда эслатма юбораман!");
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

                let targetUserId = null;

                if (ctx.message.entities) {
                    for (const ent of ctx.message.entities) {
                        if (ent.type === 'text_mention') {
                            targetUserId = ent.user.id.toString();
                            break;
                        } else if (ent.type === 'mention') {
                            const mentionedUsername = replyText.substr(ent.offset + 1, ent.length - 1).toLowerCase();
                            for (const uid in task.users) {
                                if (task.users[uid].username && task.users[uid].username.toLowerCase() === mentionedUsername) {
                                    targetUserId = uid;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }

                if (!targetUserId) {
                    const match = replyText.match(/^[\+-]\s*(\d+)$/);
                    if (match) {
                        const num = parseInt(match[1]);
                        const userIds = Object.keys(task.users);
                        if (num > 0 && num <= userIds.length) {
                            targetUserId = userIds[num - 1];
                        }
                    }
                }

                if (targetUserId && task.users[targetUserId]) {
                    task.users[targetUserId].status = isPlus ? 'bajarildi' : 'tanishdi';
                    writeDB(db);

                    let userList = "";
                    let count = 1;
                    for (const uid in task.users) {
                        const u = task.users[uid];
                        const icon = u.status === 'bajarildi' ? '✅' : '🔴';
                        const statusText = u.status === 'bajarildi' ? 'Бажарди' : 'Танишди';
                        userList += `${count}. ${icon} ${u.name} (${statusText})\n`;
                        count++;
                    }

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

        // --- ВАҚТНИ АЖРАТИБ ОЛИШ (Тошкент вақти ва хоҳланган формат учун созланган) ---
        const timeMatch = text.match(/(?:(?:muddat|муддат)\s*[:\-]?\s*)?(\d{1,2})[:\.](\d{2})/i);
        let deadlineTimestamp = null;
        let deadlineString = null;

        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const now = new Date();
            
            // Server Frankfurt (UTC) da ishlagani uchun Toshkent vaqtini (+5 soat) to'g'ri hisoblaymiz
            const deadlineDate = new Date();
            deadlineDate.setUTCHours(hours - 5, minutes, 0, 0);
            
            if (deadlineDate.getTime() <= now.getTime()) {
                deadlineDate.setDate(deadlineDate.getDate() + 1);
            }
            
            deadlineTimestamp = deadlineDate.getTime();
            deadlineString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }

        const messageContent = `📋 <b>ЯНГИ ВАЗИФА!</b>\n👤 <b>Топшириқ берувчи:</b> ${adminMention}\n\n📝 <b>Вазифа:</b> ${safeText}\n\n<b>Топшириқ ҳолати:</b>\nҲали ҳеч ким танишмади.`;

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
            adminId: ctx.from.id,
            adminMention: adminMention,
            text: safeText,
            status: 'open',
            hasMedia: hasMedia,
            deadline: deadlineTimestamp,
            deadlineString: deadlineString,
            reminderSent: false,
            users: {} 
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

    const userId = ctx.from.id;
    const safeUserName = ctx.from.first_name.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (task.users[userId]) return ctx.answerCbQuery("Сиз аллақачон танишгансиз!", { show_alert: true });

    task.users[userId] = { 
        name: safeUserName, 
        username: ctx.from.username || null,
        status: 'tanishdi' 
    };
    writeDB(db);

    let userList = "";
    let count = 1;
    for (const uid in task.users) {
        const u = task.users[uid];
        const icon = u.status === 'bajarildi' ? '✅' : '🔴';
        const statusText = u.status === 'bajarildi' ? 'Бажарди' : 'Танишди';
        userList += `${count}. ${icon} ${u.name} (${statusText})\n`;
        count++;
    }

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

    let userList = "";
    let count = 1;
    for (const uid in task.users) {
        const u = task.users[uid];
        const icon = u.status === 'bajarildi' ? '✅' : '🔴';
        const statusText = u.status === 'bajarildi' ? 'Бажарди' : 'Танишди';
        userList += `${count}. ${icon} ${u.name} (${statusText})\n`;
        count++;
    }
    if(Object.keys(task.users).length === 0) userList = "Ҳеч ким танишмади.";

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
// 3. АВТОМАТИК ЕСЛАТМА ТАЙМЕРИ (Кучайтирилган)
// ==========================================
setInterval(() => {
    const db = readDB();
    let dbChanged = false;
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    for (const taskId in db.tasks) {
        const task = db.tasks[taskId];
        
        if (task.status === 'open' && task.deadline && !task.reminderSent) {
            const timeLeft = task.deadline - now;
            
            if (timeLeft <= ONE_HOUR && timeLeft > 0) {
                task.reminderSent = true;
                dbChanged = true;

                for (const uid in task.users) {
                    if (task.users[uid].status === 'tanishdi') {
                        const msg = `⚠️ <b>ЭСЛАТМА!</b>\n\nСизда бажарилмаган вазифа бор. Муддат тугашига <b>1 соат</b> қолди!\n\n📝 <b>Вазифа:</b> ${task.text}\n⏱ <b>Муддат:</b> ${task.deadlineString}`;
                        
                        bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' }).catch(() => {});
                    }
                }
            }
        }
    }
    
    if (dbChanged) writeDB(db);
}, 30000);

bot.launch().then(() => {
    console.log("Bot muvaffaqiyatli ishga tushdi...");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));