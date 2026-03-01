// ============================================================
// ⚙️ BOT CONFIGURATION - Edit this file for your setup
// ============================================================

module.exports = {
  // Bot owner number (with country code, no + sign)
  OWNER_NUMBER: '2349049460676',

  // ============================================================
  // SUDO NUMBERS - Can use .join .exit .ban .unban
  // Owner can add more with .sudo <number>
  // ============================================================
  SUDO_NUMBERS: [
    '2349049460676',
    // Add more numbers here
  ],

  // Bot prefix
  PREFIX: '.',

  // Bot name
  BOT_NAME: 'Delta',

  // Bot creator
  CREATOR: '『 Lᴏʀᴅ Sʜᴀᴅᴏᴡ 』',

  // Community link
  COMMUNITY_LINK: 'https://chat.whatsapp.com/C58szhJGQ3EKlvFt1Hp57n',

  // Default sticker metadata
  STICKER_NAME: 'Shadow',
  STICKER_AUTHOR: 'Sʜᴀᴅᴏᴡ Gᴀʀᴅᴇɴ',

  // MENU IMAGE PATH - Put your image at: assets/delta.jpg
  MENU_IMAGE: './assets/delta.jpg',

  // Session folder
  SESSION_FOLDER: './sessions',

  // ============================================================
  // API KEYS - Fill these in!
  // ============================================================

  // 🤖 Anthropic Claude API Key (for .ai / .ask / .gpt commands)
  // Get it FREE at: https://console.anthropic.com/
  ANTHROPIC_API_KEY: 'YOUR_ANTHROPIC_API_KEY_HERE',

  // Remove.bg API Key (for background removal - optional)
  REMOVEBG_API_KEY: 'YOUR_REMOVEBG_KEY_HERE',

  // RapidAPI Key (for downloaders - optional)
  RAPIDAPI_KEY: 'YOUR_RAPIDAPI_KEY_HERE',

  // Economy settings
  DAILY_AMOUNT: 500,
  DAILY_COOLDOWN_HOURS: 24,
  STARTING_BALANCE: 50000,

  // Max warnings before auto-kick
  MAX_WARNS: 3,

  // Antilink action (kick/warn/delete)
  DEFAULT_ANTILINK_ACTION: 'warn',

  // Game settings
  GAME_BET_MIN: 10,
  SLOTS_EMOJIS: ['🍒', '🍋', '🍊', '🍇', '⭐', '💎'],

  // Card tiers
  CARD_TIERS: ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'],

  // Shop items
  SHOP_ITEMS: [
    { id: 'fishingrod',    emoji: '🎣', name: 'Fishing Rod',     price: 200,   type: 'tool',        description: 'Required to use .fish command' },
    { id: 'premium_rod',   emoji: '🎣', name: 'Premium Rod',     price: 800,   type: 'tool',        description: 'Fish with +50% bonus coins' },
    { id: 'shovel',        emoji: '⛏️', name: 'Shovel',          price: 150,   type: 'tool',        description: 'Required to use .dig command' },
    { id: 'golden_shovel', emoji: '⛏️', name: 'Golden Shovel',   price: 1000,  type: 'tool',        description: 'Dig with +100% bonus coins' },
    { id: 'pickaxe',       emoji: '⛏️', name: 'Pickaxe',         price: 500,   type: 'tool',        description: 'Mine gems with .dig (rare finds)' },
    { id: 'elixir',        emoji: '⚗️', name: 'Elixir',          price: 300,   type: 'consumable',  description: 'Doubles your next dig/fish reward' },
    { id: 'energy_drink',  emoji: '⚡', name: 'Energy Drink',    price: 150,   type: 'consumable',  description: 'Halves all cooldowns for 10 minutes' },
    { id: 'sword',         emoji: '⚔️', name: 'Sword',           price: 400,   type: 'weapon',      description: '+15 attack power in RPG battles' },
    { id: 'katana',        emoji: '🗡️', name: 'Katana',          price: 800,   type: 'weapon',      description: '+25 attack power, chance to critical hit' },
    { id: 'shield',        emoji: '🛡️', name: 'Shield',          price: 500,   type: 'defense',     description: '+20 defense in RPG battles' },
    { id: 'armor',         emoji: '🧥', name: 'Iron Armor',      price: 750,   type: 'defense',     description: '+35 defense in RPG battles' },
    { id: 'mask',          emoji: '🎭', name: 'Mask',            price: 350,   type: 'stealth',     description: '+15% rob success chance' },
    { id: 'lottery_ticket',emoji: '🎟️', name: 'Lottery Ticket',  price: 100,   type: 'gambling',    description: 'Try your luck — 5% chance at 10,000 coins!' },
    { id: 'lucky_charm',   emoji: '🍀', name: 'Lucky Charm',     price: 500,   type: 'gambling',    description: 'Increases gamble win chance to 60%' },
    { id: 'card_pack',     emoji: '🎴', name: 'Card Pack',        price: 800,   type: 'cards',       description: 'Opens 3 random cards for your collection' },
    { id: 'rare_pack',     emoji: '🔵', name: 'Rare Card Pack',   price: 2000,  type: 'cards',       description: 'Guaranteed Rare or higher card' },
    { id: 'xp_boost',      emoji: '✨', name: 'XP Boost',         price: 400,   type: 'boost',       description: 'Double XP gains for 1 hour' },
    { id: 'gem',           emoji: '💎', name: 'Gem',              price: 1000,  type: 'collectible', description: 'Rare collectible, can be traded or sold' },
    { id: 'crown',         emoji: '👑', name: 'Crown',            price: 5000,  type: 'collectible', description: 'Shows you are royalty in the group' },
    { id: 'dragon_egg',    emoji: '🥚', name: 'Dragon Egg',       price: 10000, type: 'collectible', description: 'Ultra rare — hatch it with .use dragon_egg' },
    { id: 'shadow_crystal',emoji: '🔮', name: 'Shadow Crystal',   price: 3000,  type: 'collectible', description: 'Used to evolve Mythic cards' },
  ],

  // Gambling settings
  LOTTERY_JACKPOT: 10000,
  ROULETTE_NUMBERS: 37,
};
