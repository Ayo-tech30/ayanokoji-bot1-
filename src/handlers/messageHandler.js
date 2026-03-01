const config = require('../../config');
const { Database } = require('../database/firebase');
const { isOwner, isSudo, addSudo, removeSudo, loadSudo, sleep } = require('../utils/helpers');

// Import all command handlers
const mainCommands = require('../commands/main');
const adminCommands = require('../commands/admin');
const economyCommands = require('../commands/economy');
const gamesCommands = require('../commands/games');
const gamblingCommands = require('../commands/gambling');
const interactionCommands = require('../commands/interactions');
const funCommands = require('../commands/fun');
const aiCommands = require('../commands/ai');
const converterCommands = require('../commands/converter');
const animeCommands = require('../commands/anime');
const downloaderCommands = require('../commands/downloaders');
const cardCommands = require('../commands/cards');

// ============================================================
// ANTI-LINK HANDLER
// ============================================================
async function handleAntiLink(sock, msg, groupSettings, sender, groupId) {
  if (!groupSettings.antilink) return;
  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  const linkPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/gi;
  if (!linkPattern.test(text)) return;

  const isAdmin = await isGroupAdmin(sock, groupId, sender);
  const botIsAdmin = await isBotAdmin(sock, groupId);
  if (isAdmin || !botIsAdmin || isOwner(sender)) return;

  const action = groupSettings.antilink_action || 'warn';
  try { await sock.sendMessage(groupId, { delete: msg.key }); } catch {}

  if (action === 'kick') {
    await sock.groupParticipantsUpdate(groupId, [sender], 'remove').catch(() => {});
    await sock.sendMessage(groupId, { text: `❌ @${sender.split('@')[0]} was removed for sending links!`, mentions: [sender] });
  } else if (action === 'warn') {
    const warns = await Database.addWarn(sender, groupId, 'Sending links');
    await sock.sendMessage(groupId, { text: `⚠️ @${sender.split('@')[0]} warned for links! [${warns}/${config.MAX_WARNS}]`, mentions: [sender] });
    if (warns >= config.MAX_WARNS) {
      await sock.groupParticipantsUpdate(groupId, [sender], 'remove').catch(() => {});
      await Database.resetWarns(sender, groupId);
    }
  }
}

// ============================================================
// ANTI-SPAM HANDLER
// ============================================================
const spamMap = new Map();
async function handleAntiSpam(sock, msg, groupSettings, sender, groupId) {
  if (!groupSettings.antism) return;
  const isAdmin = await isGroupAdmin(sock, groupId, sender);
  if (isAdmin || isOwner(sender)) return;

  const key = `${groupId}_${sender}`;
  const now = Date.now();
  const data = spamMap.get(key) || { count: 0, first: now };
  if (now - data.first > 10000) { spamMap.set(key, { count: 1, first: now }); return; }
  data.count++;
  spamMap.set(key, data);
  if (data.count >= 7) {
    await sock.groupParticipantsUpdate(groupId, [sender], 'remove').catch(() => {});
    await sock.sendMessage(groupId, { text: `🔨 @${sender.split('@')[0]} was kicked for spamming!`, mentions: [sender] });
    spamMap.delete(key);
  }
}

// ============================================================
// BLACKLIST HANDLER
// ============================================================
async function handleBlacklist(sock, msg, groupId, sender) {
  const bl = await Database.getBlacklist(groupId);
  if (!bl?.words?.length) return;
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').toLowerCase();
  const found = bl.words.find(w => text.includes(w.toLowerCase()));
  if (found) {
    try { await sock.sendMessage(groupId, { delete: msg.key }); } catch {}
  }
}

// ============================================================
// ADMIN CHECK HELPERS
// ============================================================
async function isGroupAdmin(sock, groupId, sender) {
  try {
    const meta = await sock.groupMetadata(groupId);
    const senderNum = sender.split(':')[0].split('@')[0];
    return meta.participants.some(p => {
      const pNum = p.id.split(':')[0].split('@')[0];
      return pNum === senderNum && (p.admin === 'admin' || p.admin === 'superadmin');
    });
  } catch { return false; }
}

function getBotId(sock) {
  // The bot number is ALWAYS the number paired to WhatsApp
  // sock.user.id format: "1234567890:5@s.whatsapp.net" or "1234567890@s.whatsapp.net"
  const raw = sock.user?.id || '';
  const num = raw.split(':')[0].split('@')[0];
  return num + '@s.whatsapp.net';
}

async function isBotAdmin(sock, groupId) {
  try {
    const meta = await sock.groupMetadata(groupId);
    const botId = getBotId(sock);
    // Check both formats of JID
    return meta.participants.some(p => {
      const pNum = p.id.split(':')[0].split('@')[0];
      const botNum = botId.split('@')[0];
      return pNum === botNum && (p.admin === 'admin' || p.admin === 'superadmin');
    });
  } catch { return false; }
}

// ============================================================
// WELCOME / LEAVE HANDLER
// ============================================================
async function handleGroupUpdate(sock, update) {
  try {
    const { id, participants, action } = update;
    const groupSettings = await Database.getGroup(id);

    for (const participant of participants) {
      if (action === 'add' && groupSettings.welcome_enabled) {
        const name = participant.split('@')[0];
        const msg = (groupSettings.welcome_message || 'Welcome {user} to the group! 🌸')
          .replace('{user}', `@${name}`);
        await sock.sendMessage(id, { text: msg, mentions: [participant] });
      }
      if (action === 'remove' && groupSettings.leave_enabled) {
        const name = participant.split('@')[0];
        const msg = (groupSettings.leave_message || 'Goodbye {user}! 👋')
          .replace('{user}', `@${name}`);
        await sock.sendMessage(id, { text: msg, mentions: [participant] });
      }
    }
  } catch {}
}

// ============================================================
// MAIN MESSAGE HANDLER
// ============================================================
async function messageHandler(sock, msg) {
  try {
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const groupId = msg.key.remoteJid;
    const isGroup = groupId.endsWith('@g.us');
    const isPrivate = !isGroup;

    // Get message text
    const msgText = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      ''
    ).trim();

    // Ban check
    const banData = await Database.getBan(sender).catch(() => null);
    if (banData?.banned) return;

    // AFK check - notify sender if someone mentioned is AFK
    if (isGroup && msgText) {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      for (const jid of mentioned) {
        const afkData = await Database.getAFK(jid).catch(() => null);
        if (afkData?.active) {
          await sock.sendMessage(groupId, {
            text: `💤 @${jid.split('@')[0]} is AFK!\n📝 Reason: ${afkData.reason}\n⏰ Since: ${new Date(afkData.since).toLocaleTimeString()}`,
            mentions: [jid]
          }, { quoted: msg });
        }
      }
      // Clear AFK if sender is back
      const myAfk = await Database.getAFK(sender).catch(() => null);
      if (myAfk?.active && !msgText.startsWith(config.PREFIX)) {
        await Database.clearAFK(sender).catch(() => {});
      }
    }

    // Activity tracking
    if (isGroup) await Database.logActivity(sender, groupId).catch(() => {});

    // Anti-features (groups only)
    if (isGroup) {
      const groupSettings = await Database.getGroup(groupId);

      // ── User-mute check: delete messages from muted users ──
      const muteKey = 'mute_' + groupId + '_' + sender;
      const muteData = await Database.getGroup(muteKey).catch(() => null);
      if (muteData?.muted && muteData.until > Date.now()) {
        const isAdmin = await isGroupAdmin(sock, groupId, sender);
        if (!isAdmin && !isOwner(sender)) {
          try { await sock.sendMessage(groupId, { delete: msg.key }); } catch {}
          return;
        }
      } else if (muteData?.muted && muteData.until <= Date.now()) {
        // Mute expired — clean it up silently
        await Database.setGroup(muteKey, { muted: false, until: 0 }).catch(() => {});
      }

      await handleAntiLink(sock, msg, groupSettings, sender, groupId);
      await handleAntiSpam(sock, msg, groupSettings, sender, groupId);
      await handleBlacklist(sock, msg, groupId, sender);
    }

    // Game response handling (non-command messages)
    if (isGroup && msgText && !msgText.startsWith(config.PREFIX)) {
      const gameCtx = {
        sock, msg, sender, groupId, isGroup,
        body: msgText,
        reply: (text) => sock.sendMessage(groupId, { text }, { quoted: msg }),
        react: (emoji) => sock.sendMessage(groupId, { react: { text: emoji, key: msg.key } }),
      };
      await gamesCommands.handleGameResponse(gameCtx).catch(() => {});
      return;
    }

    if (!msgText.startsWith(config.PREFIX)) return;

    const args = msgText.slice(config.PREFIX.length).trim().split(/\s+/);
    const command = args[0].toLowerCase();
    const body = args.slice(1).join(' ');

    const senderIsAdmin = isGroup ? await isGroupAdmin(sock, groupId, sender) : true;
    const botIsAdmin = isGroup ? await isBotAdmin(sock, groupId) : true;
    const senderIsOwner = isOwner(sender);

    const ctx = {
      sock, msg, sender, groupId, isGroup, isPrivate,
      args, command, body,
      isAdmin: senderIsAdmin,
      isBotAdmin: botIsAdmin,
      isOwner: senderIsOwner,
      // If sender is admin, treat bot as admin too for better UX
      // (avoids "make me admin" message when user IS admin)
      effectiveBotAdmin: botIsAdmin || senderIsAdmin,
      reply: (text) => sock.sendMessage(groupId, { text }, { quoted: msg }),
      react: (emoji) => sock.sendMessage(groupId, { react: { text: emoji, key: msg.key } }),
    };

    // ============================================================
    // OWNER/SUDO ONLY COMMANDS
    // ============================================================

    // .sudo - Add/remove sudo numbers (OWNER ONLY - not sudo)
    if (command === 'sudo') {
      const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
      if (sender !== ownerJid) return ctx.reply('❌ Only the main owner can manage sudo!');
      const subCmd = args[1]?.toLowerCase();
      const number = args[2] || body;

      if (subCmd === 'add') {
        if (!number) return ctx.reply('❌ Usage: .sudo add <number>');
        const clean = number.replace(/[^0-9]/g, '');
        addSudo(`${clean}@s.whatsapp.net`);
        return ctx.reply(`✅ *${clean}* added to sudo!\nThey can now use .join, .exit, .ban, .unban`);
      }
      if (subCmd === 'remove') {
        if (!number) return ctx.reply('❌ Usage: .sudo remove <number>');
        const clean = number.replace(/[^0-9]/g, '');
        removeSudo(`${clean}@s.whatsapp.net`);
        return ctx.reply(`✅ *${clean}* removed from sudo!`);
      }
      if (subCmd === 'list') {
        const list = loadSudo();
        if (!list.length) return ctx.reply('📋 No sudo users added yet!');
        return ctx.reply(`👑 *Sudo Users:*\n\n${list.map((j, i) => `${i+1}. ${j.split('@')[0]}`).join('\n')}`);
      }
      return ctx.reply('❌ Usage: .sudo add/remove/list <number>');
    }

    // .ban
    if (command === 'ban') {
      if (!ctx.isOwner) return ctx.reply('❌ Owner/Sudo only!');
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      if (!mentioned?.length) return ctx.reply('❌ Mention someone to ban!');
      await Database.banUser(mentioned[0]);
      return ctx.reply(`🔨 @${mentioned[0].split('@')[0]} has been banned!`);
    }

    // .unban
    if (command === 'unban') {
      if (!ctx.isOwner) return ctx.reply('❌ Owner/Sudo only!');
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      if (!mentioned?.length) return ctx.reply('❌ Mention someone to unban!');
      await Database.unbanUser(mentioned[0]);
      return ctx.reply(`✅ @${mentioned[0].split('@')[0]} has been unbanned!`);
    }

    // .join
    if (command === 'join') {
      if (!ctx.isOwner) return ctx.reply('❌ Owner/Sudo only!');
      if (!body) return ctx.reply('❌ Usage: .join https://chat.whatsapp.com/xxx');
      try {
        const link = body.split('chat.whatsapp.com/')[1];
        if (!link) return ctx.reply('❌ Invalid link!');
        await sock.groupAcceptInvite(link);
        return ctx.reply('✅ Joined the group!');
      } catch (e) {
        return ctx.reply(`❌ Failed to join: ${e.message}`);
      }
    }

    // .exit - Owner OR group admin can use this
    if (command === 'exit') {
      if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply('❌ Only owners or admins can use this!');
      if (!isGroup) return ctx.reply('❌ Groups only!');
      try {
        await sock.sendMessage(groupId, { text: '👋 *Goodbye everyone!*\nBot is leaving the group. 🌸' });
        await sleep(1500);
        await sock.groupLeave(groupId);
      } catch (e) {
        return ctx.reply(`❌ Failed to leave: ${e.message}`);
      }
      return;
    }

    // .spawncard - Spawn a card in a group
    if (command === 'spawncard') {
      if (!ctx.isOwner) return ctx.reply('❌ Owner/Sudo only!');
      const { spawnCard } = require('../commands/cards');
      return spawnCard(ctx, sock);
    }

    // ============================================================
    // ROUTE TO COMMAND HANDLERS
    // ============================================================
    const rpgCommands = require('../commands/games').rpg || {};
    const commandSets = [
      mainCommands, adminCommands, economyCommands, gamesCommands,
      gamblingCommands, interactionCommands, funCommands, aiCommands,
      converterCommands, animeCommands, downloaderCommands, cardCommands,
      rpgCommands
    ];

    let handled = false;
    for (const cmdSet of commandSets) {
      if (cmdSet[command]) {
        await cmdSet[command](ctx);
        handled = true;
        // Give XP for using bot commands (5-15 XP per command)
        try {
          const user = await Database.getUser(sender);
          if (user?.registered) {
            const xpGain = Math.floor(Math.random() * 11) + 5;
            const newXp = (user.xp || 0) + xpGain;
            const currentLevel = user.level || 1;
            const newLevel = Math.floor(newXp / 1000) + 1;
            await Database.setUser(sender, { xp: newXp, level: Math.max(newLevel, currentLevel) });
            if (newLevel > currentLevel) {
              const reward = newLevel * 500;
              await Database.addBalance(sender, reward);
              const lvlMsg = `🎉 @${sender.split('@')[0]} leveled up to *Level ${newLevel}*! 🌸\n💰 Reward: *${reward.toLocaleString()} coins*`;
              await sock.sendMessage(isGroup ? groupId : sender, {
                text: lvlMsg,
                mentions: [sender]
              });
            }
          }
        } catch {}
        break;
      }
    }

    // Aliases
    if (!handled) {
      const aliases = {
        'mbal': 'moneybalance', 'pbal': 'premiumbal', 'wid': 'withdraw',
        'dep': 'deposit', 'reg': 'register', 'p': 'profile', 'inv': 'inventory',
        'lb': 'leaderboard', 'gi': 'groupinfo', 'gs': 'groupstats',
        'ttt': 'tictactoe', 'c4': 'connectfour', 'wcg': 'wordchain',
        's': 'sticker', 'toimg': 'turnimg', 'tovid': 'turnvid',
        'tt': 'translate', 'ask': 'ask', 'gpt': 'ai', 'claude': 'ai',
        'roast': 'roast', 'compliment': 'compliment', 'advice': 'advice',
        'story': 'story', 'poem': 'poem', 'clearchat': 'clearchat',
        'coll': 'collection', 'ci': 'cardinfo',
        'mycolls': 'mycollectionseries', 'cardlb': 'cardleaderboard',
        'auc': 'auction', 'wyr': 'wouldyourather', 'td': 'truthordare',
        'pp': 'psize', 'nsfw': 'nude', 'cf': 'coinflip',
        'db': 'doublebet', 'dp': 'doublepayout', 'gpt': 'ai',
        'richlg': 'richlistglobal', 'rename': 'setname', 'steal': 'rob',
        'startuno': 'startuno', 'unoplay': 'unoplay',
        'unodraw': 'unodraw', 'unohand': 'unohand', 'stopgame': 'stopgame',
      };

      const aliasCmd = aliases[command];
      if (aliasCmd) {
        const allCmds = Object.assign({}, ...commandSets);
        if (allCmds[aliasCmd]) await allCmds[aliasCmd]({ ...ctx, command: aliasCmd });
      }
    }

  } catch (err) {
    console.error('Message handler error:', err.message);
  }
}

module.exports = { messageHandler, handleGroupUpdate, isGroupAdmin, isBotAdmin };
