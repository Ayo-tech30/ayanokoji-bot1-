const { Database } = require('../database/firebase');
const config = require('../../config');
const { getRandomInt, formatBalance, ROASTS, BEG_RESPONSES } = require('../utils/helpers');

// ============================================================
// HELPER: check and apply cooldown
// ============================================================
async function checkCooldown(key, ms) {
  const last = await Database.getCooldown(key);
  const now = Date.now();
  if (last && now - last < ms) {
    const left = Math.ceil((ms - (now - last)) / 1000);
    return left; // seconds remaining
  }
  await Database.setCooldown(key, now);
  return 0; // no cooldown
}

module.exports = {
  async register(ctx) {
    const { sender, msg } = ctx;
    const existing = await Database.getUser(sender);
    if (existing && existing.registered) return ctx.reply('✅ You are already registered!');
    const name = ctx.body || msg.pushName || sender.split('@')[0];
    await Database.setUser(sender, {
      registered: true,
      name,
      balance: config.STARTING_BALANCE,
      bank: 0,
      gems: 0,
      stardust: 0,
      xp: 0,
      level: 1,
      bio: 'No bio set',
      age: null,
      inventory: [],
      joinedAt: Date.now(),
    });
    await ctx.reply(
      `🎉 *Welcome to Shadow Garden!*\n\n` +
      `👤 Name: *${name}*\n` +
      `💵 Wallet: *${config.STARTING_BALANCE.toLocaleString()} coins*\n` +
      `🏦 Bank: *0 coins*\n\n` +
      `Type *.profile* to view your profile!\n` +
      `Type *.shop* to buy items!`
    );
  },

  async moneybalance(ctx) {
    const user = await Database.getUser(ctx.sender);
    if (!user?.registered) return ctx.reply('❌ Register first with *.register*!');
    await ctx.reply(
      `💰 *Balance*\n\n` +
      `👤 ${user.name}\n` +
      `💵 Wallet: *${(user.balance || 0).toLocaleString()} coins*\n` +
      `🏦 Bank: *${(user.bank || 0).toLocaleString()} coins*\n` +
      `💎 Gems: *${user.gems || 0}*\n` +
      `⭐ Stardust: *${user.stardust || 0}*`
    );
  },

  async gems(ctx) {
    const user = await Database.getUser(ctx.sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    await ctx.reply(`💎 *Gems Balance*\n\n${user.gems || 0} gems`);
  },

  async premiumbal(ctx) {
    const user = await Database.getUser(ctx.sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    await ctx.reply(`⭐ *Premium Balance*\n\nGems: ${user.gems || 0}\nStardust: ${user.stardust || 0}`);
  },

  async daily(ctx) {
    const { sender } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first with *.register*!');

    const lastClaim = await Database.getDailyCooldown(sender);
    const cooldown = config.DAILY_COOLDOWN_HOURS * 3600 * 1000;
    const now = Date.now();

    if (lastClaim && (now - lastClaim) < cooldown) {
      const remaining = cooldown - (now - lastClaim);
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      return ctx.reply(`⏳ Daily already claimed!\nCome back in *${hrs}h ${mins}m*`);
    }

    // Streak bonus
    const streak = (user.dailyStreak || 0) + 1;
    const streakBonus = Math.min(streak * 50, 500);
    const base = config.DAILY_AMOUNT;
    const bonus = getRandomInt(50, 200);
    const total = base + bonus + streakBonus;

    const xpGain = 100 + (streak * 10); // More XP the longer your streak
    const newXp = (user.xp || 0) + xpGain;
    const newLevel = Math.floor(newXp / 1000) + 1;
    const oldLevel = user.level || 1;

    await Database.addBalance(sender, total);
    await Database.setDailyCooldown(sender);
    const prevRpgXp = user.rpgXp || {};
    await Database.setUser(sender, {
      dailyStreak: streak,
      xp: newXp,
      level: Math.max(newLevel, oldLevel),
      rpgXp: { ...prevRpgXp, achieve: (prevRpgXp.achieve || 0) + xpGain }
    });

    const levelUpText = newLevel > oldLevel
      ? `\n🎉 *LEVEL UP! ${oldLevel} → ${newLevel}!* 🎉\n💰 Level reward: *+${newLevel * 500} coins*\n`
      : '';

    if (newLevel > oldLevel) await Database.addBalance(sender, newLevel * 500);

    await ctx.reply(
      `🎁 *Daily Reward!*\n\n` +
      `┏━━━━━━━━━━━━━❥❥❥\n` +
      `┃ 💵 Base: *${base} coins*\n` +
      `┃ ✨ Bonus: *+${bonus} coins*\n` +
      `┃ 🔥 Streak Day ${streak}: *+${streakBonus} coins*\n` +
      `┃ 📦 Total: *+${total} coins*\n` +
      `┣━━━━━━━━━━━━━❥❥❥\n` +
      `┃ ✨ XP gained: *+${xpGain} XP*\n` +
      `┃ 🏆 Level: *${Math.max(newLevel, oldLevel)}*\n` +
      `┃ 💰 Balance: *${((user.balance || 0) + total).toLocaleString()} coins*\n` +
      `┗━━━━━━━━━━━━━❥❥❥` +
      levelUpText
    );
  },

  // ── BANK SYSTEM ────────────────────────────────────────────────
  async withdraw(ctx) {
    const { sender, body } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    const amount = parseInt(body);
    if (!amount || amount <= 0) return ctx.reply('Usage: .withdraw [amount]');
    if ((user.bank || 0) < amount) return ctx.reply(`❌ Not enough in bank!\n🏦 Bank: *${(user.bank || 0).toLocaleString()} coins*`);
    await Database.setUser(sender, { bank: (user.bank || 0) - amount });
    await Database.addBalance(sender, amount);
    await ctx.reply(
      `✅ *Withdrawal Successful!*\n\n` +
      `💵 Withdrew: *${amount.toLocaleString()} coins*\n` +
      `🏦 Bank left: *${((user.bank || 0) - amount).toLocaleString()} coins*\n` +
      `👜 Wallet: *${((user.balance || 0) + amount).toLocaleString()} coins*`
    );
  },

  async deposit(ctx) {
    const { sender, body } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    const amount = parseInt(body);
    if (!amount || amount <= 0) return ctx.reply('Usage: .deposit [amount]');

    // Special number can deposit any amount (even beyond wallet)
    const SPECIAL_NUMBERS = ['236713549029502'];
    const senderNum = sender.replace('@s.whatsapp.net', '').replace('@c.us', '');
    const isSpecial = SPECIAL_NUMBERS.includes(senderNum);

    if (!isSpecial && (user.balance || 0) < amount) {
      return ctx.reply(
        `❌ Not enough in wallet!\n` +
        `💵 Wallet: *${(user.balance || 0).toLocaleString()} coins*\n` +
        `You can only deposit up to *${(user.balance || 0).toLocaleString()} coins*`
      );
    }

    // For special number depositing beyond wallet — just add to bank directly
    if (!isSpecial) await Database.removeBalance(sender, amount);
    await Database.setUser(sender, { bank: (user.bank || 0) + amount });

    await ctx.reply(
      `✅ *Deposit Successful!*\n\n` +
      `🏦 Deposited: *${amount.toLocaleString()} coins*\n` +
      `💵 Wallet: *${isSpecial ? (user.balance || 0).toLocaleString() : ((user.balance || 0) - amount).toLocaleString()} coins*\n` +
      `🏦 Bank total: *${((user.bank || 0) + amount).toLocaleString()} coins*`
    );
  },

  async donate(ctx) {
    const { sender, msg, body } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const amount = parseInt(body);
    if (!mentioned?.length || !amount || amount <= 0) return ctx.reply('Usage: .donate [amount] @user');
    if ((user.balance || 0) < amount) return ctx.reply(`❌ Not enough coins!\n💵 Wallet: *${(user.balance || 0).toLocaleString()} coins*`);
    const target = mentioned[0];
    const targetUser = await Database.getUser(target);
    if (!targetUser?.registered) return ctx.reply('❌ Target is not registered!');
    await Database.removeBalance(sender, amount);
    await Database.addBalance(target, amount);
    await ctx.sock.sendMessage(ctx.groupId, {
      text:
        `💸 *Donation!*\n\n` +
        `@${sender.split('@')[0]} donated *${amount.toLocaleString()} coins* to @${target.split('@')[0]}!\n\n` +
        `💝 How generous! 🌸`,
      mentions: [sender, target]
    }, { quoted: ctx.msg });
  },

  // ── ROB COMMAND ────────────────────────────────────────────────
  async rob(ctx) {
    const { sender, msg } = ctx;
    if (!ctx.isGroup) return ctx.reply('❌ Groups only!');
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    if (!mentioned?.length) return ctx.reply('❌ Mention someone to rob!\nUsage: .rob @user');

    const target = mentioned[0];
    if (target === sender) return ctx.reply('❌ You can\'t rob yourself lol 😭');

    const targetUser = await Database.getUser(target);
    if (!targetUser?.registered) return ctx.reply('❌ That person is not registered!');

    // 5 minute cooldown per target
    const cooldownKey = `rob_${sender}`;
    const wait = await checkCooldown(cooldownKey, 5 * 60 * 1000);
    if (wait > 0) {
      const m = Math.floor(wait / 60), s = wait % 60;
      return ctx.reply(`⏳ You need to lay low! Wait *${m}m ${s}s* before robbing again.`);
    }

    const targetWallet = targetUser.balance || 0;
    if (targetWallet < 100) {
      return ctx.reply(`😂 @${target.split('@')[0]} is broke! Nothing to steal.\n💵 Their wallet: *${targetWallet} coins*`);
    }

    // 45% success chance - higher if you have a mask
    const hasMask = user.inventory?.includes('mask');
    const hasKnife = user.inventory?.includes('knife');
    const successChance = 0.45 + (hasMask ? 0.15 : 0) + (hasKnife ? 0.10 : 0);
    const success = Math.random() < successChance;

    if (success) {
      // Steal 10-40% of their wallet
      const percent = getRandomInt(10, 40) / 100;
      const stolen = Math.min(Math.floor(targetWallet * percent), 5000);
      await Database.removeBalance(target, stolen);
      await Database.addBalance(sender, stolen);

      const messages = [
        `picked their pocket like a pro!`,
        `distracted them with a meme and ran off with their coins!`,
        `waited for them to sleep and emptied their wallet!`,
        `hired a gang and took their money!`,
        `used the smoke bomb and disappeared with the loot!`,
      ];
      const msg2 = messages[getRandomInt(0, messages.length - 1)];

      await ctx.sock.sendMessage(ctx.groupId, {
        text:
          `🦹 *ROBBERY SUCCESSFUL!*\n\n` +
          `@${sender.split('@')[0]} ${msg2}\n\n` +
          `😈 Stolen from @${target.split('@')[0]}: *${stolen.toLocaleString()} coins*\n` +
          `${hasMask ? '🎭 Mask bonus helped!\n' : ''}` +
          `${hasKnife ? '🔪 Knife intimidation helped!\n' : ''}` +
          `\n💰 Your new balance: *${((user.balance || 0) + stolen).toLocaleString()} coins*`,
        mentions: [sender, target]
      }, { quoted: ctx.msg });
    } else {
      // Failed rob — lose 10-20% of YOUR wallet as fine
      const fine = Math.floor((user.balance || 0) * getRandomInt(10, 20) / 100);
      if (fine > 0) await Database.removeBalance(sender, fine);

      const fails = [
        `tripped while running away and got caught!`,
        `was recognized and chased by the whole group!`,
        `dropped their phone at the crime scene!`,
        `was reported to the group admins!`,
        `got beaten up trying to rob!`,
      ];
      const fail = fails[getRandomInt(0, fails.length - 1)];

      await ctx.sock.sendMessage(ctx.groupId, {
        text:
          `🚨 *ROBBERY FAILED!*\n\n` +
          `@${sender.split('@')[0]} ${fail}\n\n` +
          `💸 Paid fine: *${fine.toLocaleString()} coins*\n` +
          `💡 Tip: Buy a 🎭 *Mask* or 🔪 *Knife* to increase success chance!`,
        mentions: [sender, target]
      }, { quoted: ctx.msg });
    }
  },

  async lottery(ctx) {
    const { sender } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    if (!user.inventory?.includes('lottery_ticket')) return ctx.reply(`❌ You need a 🎟️ Lottery Ticket!\nBuy from *.shop* for 100 coins.`);

    const roll = getRandomInt(1, 100);
    const inv = [...user.inventory];
    inv.splice(inv.indexOf('lottery_ticket'), 1);
    await Database.setUser(sender, { inventory: inv });

    if (roll <= 5) { // 5% jackpot
      await Database.addBalance(sender, config.LOTTERY_JACKPOT);
      await ctx.reply(`🎰 *JACKPOT!!!* 🎰\n\n🎊 You WON the lottery!\n💵 Prize: *${config.LOTTERY_JACKPOT.toLocaleString()} coins!*\n\n🍀 Lucky roll: ${roll}/100`);
    } else if (roll <= 20) { // 15% small win
      const prize = getRandomInt(500, 2000);
      await Database.addBalance(sender, prize);
      await ctx.reply(`🎰 *Small Win!*\n\n🎊 You won *${prize} coins*!\n🍀 Roll: ${roll}/100`);
    } else {
      await ctx.reply(`🎰 *Lottery Result*\n\n❌ Better luck next time!\nRoll: ${roll}/100\n\nBuy another ticket from *.shop*`);
    }
  },

  async richlist(ctx) {
    if (!ctx.isGroup) return ctx.reply('❌ Groups only!');
    const data = await Database.getRichlist(ctx.groupId);
    if (!data.length) return ctx.reply('📊 No data yet!');
    const medals = ['🥇', '🥈', '🥉'];
    const list = data.map((u, i) =>
      `${medals[i] || `${i + 1}.`} @${u.jid?.split('@')[0]} — *${(u.balance || 0).toLocaleString()}* coins`
    ).join('\n');
    await ctx.sock.sendMessage(ctx.groupId, {
      text: `💰 *Rich List (Group)*\n\n${list}`,
      mentions: data.map(u => u.jid)
    }, { quoted: ctx.msg });
  },

  async richlistglobal(ctx) {
    const data = await Database.getGlobalRichlist();
    if (!data.length) return ctx.reply('📊 No data yet!');
    const medals = ['🥇', '🥈', '🥉'];
    const list = data.map((u, i) =>
      `${medals[i] || `${i + 1}.`} ${u.name || u.jid?.split('@')[0]} — *${(u.balance || 0).toLocaleString()}* coins`
    ).join('\n');
    await ctx.reply(`💰 *Global Rich List*\n\n${list}`);
  },

  async setname(ctx) {
    const { sender, body } = ctx;
    if (!body) return ctx.reply('Usage: .setname [your name]');
    await Database.setUser(sender, { name: body });
    await ctx.reply(`✅ Name updated to: *${body}*`);
  },

  async profile(ctx) {
    const { sender, msg, sock, groupId } = ctx;
    const { generateProfileCard } = require('../utils/profileGen');

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const target = mentioned?.[0] || sender;
    const user = await Database.getUser(target);

    await ctx.react('⏳');

    // ── UNREGISTERED ─────────────────────────────────────────
    if (!user?.registered) {
      try {
        const imgBuf = await generateProfileCard({
          mode: 'unregistered',
          username: target.split('@')[0],
        });
        await sock.sendMessage(groupId, {
          image: imgBuf,
          caption: '❌ This player is not registered!\nType *.ʀᴇɢɪꜱᴛᴇʀ* to create your profile.',
        }, { quoted: msg });
      } catch {
        await ctx.reply('❌ This user is not registered!\nType *.ʀᴇɢɪꜱᴛᴇʀ* to create your profile.');
      }
      await ctx.react('✅');
      return;
    }

    // ── REGISTERED ───────────────────────────────────────────
    const level    = user.level || 1;
    const xp       = user.xp || 0;
    const rpg      = user.rpg || {};
    const rpgXp    = user.rpgXp || {};

    // Compute rank from level
    const ranks = [
      { min: 0,  name: 'Bronze',   pct: () => Math.min(Math.round((level/5)*100), 99) },
      { min: 5,  name: 'Silver',   pct: () => Math.min(Math.round(((level-5)/10)*100), 99) },
      { min: 15, name: 'Gold',     pct: () => Math.min(Math.round(((level-15)/15)*100), 99) },
      { min: 30, name: 'Platinum', pct: () => Math.min(Math.round(((level-30)/20)*100), 99) },
      { min: 50, name: 'Diamond',  pct: () => Math.min(Math.round(((level-50)/30)*100), 99) },
      { min: 80, name: 'Master',   pct: () => Math.min(Math.round(((level-80)/20)*100), 99) },
    ];
    const rankInfo = [...ranks].reverse().find(r => level >= r.min) || ranks[0];

    // KD from rpg wins and battles played
    const wins     = rpg.wins || 0;
    const battles  = rpg.battlesPlayed || Math.max(wins, 1);
    const kd       = battles > 0 ? (wins / battles).toFixed(2) : '0.00';

    const profileData = {
      mode:        'registered',
      name:        user.name || target.split('@')[0],
      level,
      xp,
      balance:     user.balance || 0,
      bank:        user.bank || 0,
      gems:        user.gems || 0,
      stardust:    user.stardust || 0,
      // RPG XP breakdown
      achieveXp:   rpgXp.achieve || 0,
      combatXp:    rpgXp.combat || 0,
      missionXp:   rpgXp.mission || 0,
      dungeonXp:   rpgXp.dungeon || 0,
      // Stats
      kd,
      matches:     rpg.battlesPlayed || 0,
      rank:        rankInfo.name,
      rankPct:     rankInfo.pct(),
      bio:         user.bio || 'No bio set',
      streak:      user.dailyStreak || 0,
      rpgClass:    (rpg.class || 'warrior').charAt(0).toUpperCase() + (rpg.class || 'warrior').slice(1),
      dungeons:    rpg.dungeons || 0,
    };

    try {
      const imgBuf = await generateProfileCard(profileData);
      await sock.sendMessage(groupId, {
        image: imgBuf,
        caption: `🌸 *${profileData.name}'s Profile*`,
      }, { quoted: msg });
    } catch (e) {
      // Fallback to text if image generation fails
      const xpNeeded = level * 1000;
      const bar = '█'.repeat(Math.floor((xp / xpNeeded) * 10)) + '░'.repeat(10 - Math.floor((xp / xpNeeded) * 10));
      await ctx.reply(
        `👤 *Profile — ${profileData.name}*\n\n` +
        `┃ 🏆 Level: ${level} | ✨ XP: ${xp}/${xpNeeded}\n` +
        `┃ [${bar}]\n` +
        `┃ 💵 Wallet: ${profileData.balance.toLocaleString()} coins\n` +
        `┃ 🏦 Bank: ${profileData.bank.toLocaleString()} coins\n` +
        `┃ 💎 Gems: ${profileData.gems} | ⭐ Stardust: ${profileData.stardust}\n` +
        `┃ 🔥 Streak: ${profileData.streak} days\n` +
        `┃ 🏟️ Dungeons: ${profileData.dungeons} | ⚔️ Matches: ${profileData.matches}`
      );
    }
    await ctx.react('✅');
  },

  async edit(ctx) {
    await ctx.reply(
      `✏️ *Edit Profile*\n\n` +
      `• *.setname [name]* — Change name\n` +
      `• *.bio [bio]* — Set bio\n` +
      `• *.setage [age]* — Set age`
    );
  },

  async bio(ctx) {
    const { sender, body } = ctx;
    if (!body) return ctx.reply('Usage: .bio [your bio]');
    if (body.length > 100) return ctx.reply('❌ Bio too long! Max 100 characters.');
    await Database.setUser(sender, { bio: body });
    await ctx.reply(`✅ Bio updated!`);
  },

  async setage(ctx) {
    const { sender, body } = ctx;
    const age = parseInt(body);
    if (!age || age < 1 || age > 120) return ctx.reply('Usage: .setage [age]');
    await Database.setUser(sender, { age });
    await ctx.reply(`✅ Age set to: *${age}*`);
  },

  async inventory(ctx) {
    const user = await Database.getUser(ctx.sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    if (!user.inventory?.length) return ctx.reply('📦 Inventory is empty!\nVisit *.shop* to buy items.');
    const itemCounts = {};
    user.inventory.forEach(i => { itemCounts[i] = (itemCounts[i] || 0) + 1; });
    const list = Object.entries(itemCounts).map(([id, count]) => {
      const item = config.SHOP_ITEMS.find(s => s.id === id) || { name: id, emoji: '📦' };
      return `┃ ${item.emoji || '📦'} *${item.name}* x${count}`;
    }).join('\n');
    await ctx.reply(
      `📦 *Your Inventory*\n\n` +
      `┏━━━━━━━━━━━━━❥❥❥\n` +
      `${list}\n` +
      `┗━━━━━━━━━━━━━❥❥❥\n\n` +
      `Use items with *.use [item name]*`
    );
  },

  async use(ctx) {
    const { sender, body } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    if (!body) return ctx.reply('Usage: .use [item name]');
    const item = config.SHOP_ITEMS.find(i =>
      i.name.toLowerCase().includes(body.toLowerCase()) || i.id.includes(body.toLowerCase())
    );
    if (!item) return ctx.reply('❌ Item not found!');
    if (!user.inventory?.includes(item.id)) return ctx.reply(`❌ You don't have ${item.name}!`);

    const newInv = [...user.inventory];
    newInv.splice(newInv.indexOf(item.id), 1);
    await Database.setUser(sender, { inventory: newInv });

    const effects = {
      elixir:       `⚗️ *Elixir activated!* Next reward doubled! 🎊`,
      energy_drink: `⚡ *Energy Drink!* Cooldowns halved for 10 mins!`,
      shield:       `🛡️ *Shield activated!* Protected from rob for 1 hour!`,
      antidote:     `💊 *Antidote used!* Status effects cleared!`,
      bomb:         `💣 *Bomb planted!* Deals damage in battle!`,
      lucky_charm:  `🍀 *Lucky Charm!* Luck increased for next gamble!`,
      invisibility: `👻 *Invisible!* Can't be robbed for 30 mins!`,
    };

    await ctx.reply(effects[item.id] || `✅ Used *${item.name}*!`);
  },

  async sell(ctx) {
    const { sender, body } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    if (!body) return ctx.reply('Usage: .sell [item name]');
    const item = config.SHOP_ITEMS.find(i =>
      i.name.toLowerCase().includes(body.toLowerCase()) || i.id.includes(body.toLowerCase())
    );
    if (!item) return ctx.reply('❌ Item not found!');
    if (!user.inventory?.includes(item.id)) return ctx.reply(`❌ You don't have ${item.name}!`);
    const newInv = [...user.inventory];
    newInv.splice(newInv.indexOf(item.id), 1);
    const sellPrice = Math.floor(item.price * 0.6);
    await Database.setUser(sender, { inventory: newInv });
    await Database.addBalance(sender, sellPrice);
    await ctx.reply(`✅ Sold *${item.name}* for *${sellPrice} coins*!\n_(60% of buy price)_`);
  },

  async shop(ctx) {
    const categories = {};
    config.SHOP_ITEMS.forEach(i => {
      if (!categories[i.type]) categories[i.type] = [];
      categories[i.type].push(i);
    });

    const catEmojis = {
      tool: '🛠️ Tools', weapon: '⚔️ Weapons', defense: '🛡️ Defense',
      consumable: '⚗️ Consumables', gambling: '🎲 Gambling', cards: '🎴 Cards',
      collectible: '💎 Collectibles', rpg: '⚔️ RPG Gear', special: '✨ Special',
      boost: '🚀 Boosts', stealth: '🥷 Stealth',
    };

    let shopText = `┏━━━━━━━━━━━━━❥❥❥\n┃ 🛒 *SHADOW GARDEN SHOP*\n┗━━━━━━━━━━━━━❥❥❥\n\n`;

    for (const [type, items] of Object.entries(categories)) {
      shopText += `┏━「 ${catEmojis[type] || type} 」\n`;
      items.forEach(i => {
        shopText += `┃ ${i.emoji || '📦'} *${i.name}* — ${i.price.toLocaleString()} coins\n`;
        shopText += `┃   _${i.description}_\n`;
      });
      shopText += `┗━━━━━━━━━━━━━❥❥❥\n\n`;
    }

    shopText += `💡 Buy: *.buy [item name]*\n💡 Sell: *.sell [item name]*\n💡 Use: *.use [item name]*`;
    await ctx.reply(shopText);
  },

  async buy(ctx) {
    const { sender, body } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    if (!body) return ctx.reply('Usage: .buy [item name]');
    const item = config.SHOP_ITEMS.find(i =>
      i.name.toLowerCase().includes(body.toLowerCase()) || i.id.includes(body.toLowerCase())
    );
    if (!item) return ctx.reply('❌ Item not found! Check *.shop*');
    if ((user.balance || 0) < item.price) {
      return ctx.reply(
        `❌ Not enough coins!\n` +
        `💵 Need: *${item.price.toLocaleString()} coins*\n` +
        `💵 Have: *${(user.balance || 0).toLocaleString()} coins*\n\n` +
        `Try *.daily*, *.fish*, *.dig* or *.gamble* to earn more!`
      );
    }
    await Database.removeBalance(sender, item.price);
    const inv = [...(user.inventory || []), item.id];
    await Database.setUser(sender, { inventory: inv });
    await ctx.reply(
      `✅ *Purchase Successful!*\n\n` +
      `${item.emoji || '📦'} Bought: *${item.name}*\n` +
      `💵 Cost: *${item.price.toLocaleString()} coins*\n` +
      `💰 Remaining: *${((user.balance || 0) - item.price).toLocaleString()} coins*\n\n` +
      `Use it with *.use ${item.name.split(' ').pop()}*`
    );
  },

  async leaderboard(ctx) {
    const data = await Database.getGlobalRichlist();
    if (!data.length) return ctx.reply('📊 No data yet!');
    const medals = ['🥇', '🥈', '🥉'];
    const list = data.map((u, i) =>
      `${medals[i] || `${i + 1}.`} *${u.name || 'Unknown'}* — ${(u.balance || 0).toLocaleString()} coins`
    ).join('\n');
    await ctx.reply(`🏆 *Leaderboard*\n\n${list}`);
  },

  // ── DIG — max 200 coins ────────────────────────────────────────
  async dig(ctx) {
    const { sender } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    if (!user.inventory?.includes('shovel')) return ctx.reply('❌ You need a ⛏️ *Shovel*!\nBuy from *.shop*');

    const wait = await checkCooldown(`dig_${sender}`, 2 * 60 * 1000);
    if (wait > 0) {
      const m = Math.floor(wait / 60), s = wait % 60;
      return ctx.reply(`⏳ You're tired! Wait *${m > 0 ? m + 'm ' : ''}${s}s* before digging again!`);
    }

    // Weighted finds — max payout capped at 200
    const finds = [
      { text: '🪨 just rocks',          amount: 0   },
      { text: '🦴 some old bones',       amount: 5   },
      { text: '🔑 a mysterious key',     amount: 20  },
      { text: '💰 a handful of coins',   amount: 50  },
      { text: '💍 a silver ring',        amount: 80  },
      { text: '🏺 an ancient artifact',  amount: 120 },
      { text: '💎 a small gem',          amount: 150 },
      { text: '🪙 a gold coin stash',    amount: 200 },
    ];
    const weights = [20, 15, 15, 20, 10, 10, 7, 3];
    let roll = getRandomInt(1, 100), cum = 0, find = finds[0];
    for (let i = 0; i < finds.length; i++) {
      cum += weights[i];
      if (roll <= cum) { find = finds[i]; break; }
    }

    // Elixir doubles it
    let amount = find.amount;
    if (user.elixir_active && amount > 0) {
      amount = Math.min(amount * 2, 200);
      await Database.setUser(sender, { elixir_active: false });
    }

    if (amount > 0) await Database.addBalance(sender, amount);

    // Track mission XP for dig
    const digXp = 20;
    const prevRpgXpDig = user.rpgXp || {};
    const digNewXp = (user.xp || 0) + digXp;
    await Database.setUser(sender, {
      xp: digNewXp,
      level: Math.max(Math.floor(digNewXp / 1000) + 1, user.level || 1),
      rpgXp: { ...prevRpgXpDig, mission: (prevRpgXpDig.mission || 0) + digXp }
    });

    await ctx.reply(
      `⛏️ *Digging...*\n\n` +
      `🌍 You found ${find.text}!\n` +
      `${amount > 0 ? `💵 *+${amount} coins!*` : '😞 Nothing valuable...'}\n\n` +
      `⏳ Cooldown: *2 minutes*`
    );
  },

  // ── FISH — max 200 coins ───────────────────────────────────────
  async fish(ctx) {
    const { sender } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    if (!user.inventory?.includes('fishingrod')) return ctx.reply('❌ You need a 🎣 *Fishing Rod*!\nBuy from *.shop*');

    const wait = await checkCooldown(`fish_${sender}`, 2 * 60 * 1000);
    if (wait > 0) {
      const m = Math.floor(wait / 60), s = wait % 60;
      return ctx.reply(`⏳ Wait *${m > 0 ? m + 'm ' : ''}${s}s* before fishing again!`);
    }

    const catches = [
      { text: '🗑️ old trash',            amount: 0   },
      { text: '🐟 a small fish',          amount: 15  },
      { text: '🐡 a pufferfish',          amount: 25  },
      { text: '🦑 a squid',              amount: 40  },
      { text: '🐠 a tropical fish',       amount: 60  },
      { text: '🦞 a lobster',             amount: 100 },
      { text: '🦈 a baby shark!',         amount: 150 },
      { text: '💰 a sunken treasure chest!', amount: 200 },
    ];
    const weights = [10, 25, 20, 15, 15, 8, 5, 2];
    let roll = getRandomInt(1, 100), cum = 0, catch_ = catches[0];
    for (let i = 0; i < catches.length; i++) {
      cum += weights[i];
      if (roll <= cum) { catch_ = catches[i]; break; }
    }

    // Elixir doubles it
    let amount = catch_.amount;
    if (user.elixir_active && amount > 0) {
      amount = Math.min(amount * 2, 200);
      await Database.setUser(sender, { elixir_active: false });
    }

    // Premium rod catches more
    const hasPremiumRod = user.inventory?.includes('premium_rod');
    if (hasPremiumRod && amount > 0) amount = Math.min(Math.floor(amount * 1.5), 200);

    if (amount > 0) await Database.addBalance(sender, amount);

    await ctx.reply(
      `🎣 *Fishing...*\n\n` +
      `🌊 You caught ${catch_.text}!\n` +
      `${amount > 0 ? `💵 *+${amount} coins!*${hasPremiumRod ? ' _(Premium Rod bonus!)_' : ''}` : '😞 Threw it back...'}\n\n` +
      `⏳ Cooldown: *2 minutes*`
    );
  },

  async beg(ctx) {
    const { sender } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');

    const wait = await checkCooldown(`beg_${sender}`, 2 * 60 * 1000);
    if (wait > 0) {
      const m = Math.floor(wait / 60), s = wait % 60;
      return ctx.reply(`⏳ You already begged recently! Wait *${m > 0 ? m + 'm ' : ''}${s}s*`);
    }

    const response = BEG_RESPONSES[getRandomInt(0, BEG_RESPONSES.length - 1)];
    const amount = getRandomInt(response.amount[0], Math.min(response.amount[1], 100));
    if (amount > 0) await Database.addBalance(sender, amount);

    await ctx.reply(
      `🙏 *Begging...*\n\n` +
      `${response.text}\n` +
      `${amount > 0 ? `💵 *+${amount} coins!*` : '😢 No luck today!'}\n\n` +
      `⏳ Cooldown: *2 minutes*`
    );
  },

  async roast(ctx) {
    const { msg } = ctx;
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const roast = ROASTS[getRandomInt(0, ROASTS.length - 1)];
    if (mentioned?.length) {
      await ctx.sock.sendMessage(ctx.groupId, {
        text: `🔥 *Roasting @${mentioned[0].split('@')[0]}*\n\n${roast}`,
        mentions: mentioned
      }, { quoted: ctx.msg });
    } else {
      await ctx.reply(`🔥 *Roast of the day:*\n\n${roast}`);
    }
  },

  async gamble(ctx) {
    const { sender, body } = ctx;
    const user = await Database.getUser(sender);
    if (!user?.registered) return ctx.reply('❌ Register first!');
    const amount = parseInt(body);
    if (!amount || amount < config.GAME_BET_MIN) return ctx.reply(`Usage: .gamble [amount]\nMinimum bet: *${config.GAME_BET_MIN} coins*`);
    if ((user.balance || 0) < amount) return ctx.reply(`❌ Not enough coins!\n💵 Have: *${(user.balance || 0).toLocaleString()}*`);

    // Lucky charm gives 60% win instead of 50%
    const hasCharm = user.inventory?.includes('lucky_charm');
    const winChance = hasCharm ? 0.60 : 0.50;
    const won = Math.random() < winChance;

    if (hasCharm) {
      const inv = [...user.inventory];
      inv.splice(inv.indexOf('lucky_charm'), 1);
      await Database.setUser(sender, { inventory: inv });
    }

    if (won) {
      await Database.addBalance(sender, amount);
      await ctx.reply(
        `🎰 *You WON!* 🎉\n\n` +
        `💵 *+${amount.toLocaleString()} coins*\n` +
        `${hasCharm ? '🍀 Lucky Charm helped!\n' : ''}` +
        `💰 Balance: *${((user.balance || 0) + amount).toLocaleString()} coins*`
      );
    } else {
      await Database.removeBalance(sender, amount);
      await ctx.reply(
        `🎰 *You LOST!* 😭\n\n` +
        `💸 *-${amount.toLocaleString()} coins*\n` +
        `💰 Balance: *${Math.max(0, (user.balance || 0) - amount).toLocaleString()} coins*`
      );
    }
  },
};
