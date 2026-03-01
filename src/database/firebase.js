// ============================================================
// LOCAL JSON DATABASE — Replaces Firebase
// Zero dependencies. Never expires. Never fails.
// Data saved to: data/ folder in bot root
// ============================================================
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── In-memory cache + file persistence ──────────────────────
const cache = {};
const writeQueues = {};

function dbFile(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function loadTable(name) {
  if (cache[name]) return cache[name];
  const file = dbFile(name);
  try {
    cache[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    cache[name] = {};
  }
  return cache[name];
}

function saveTable(name) {
  // Debounced write — batch saves every 500ms to avoid disk spam
  if (writeQueues[name]) clearTimeout(writeQueues[name]);
  writeQueues[name] = setTimeout(() => {
    try {
      fs.writeFileSync(dbFile(name), JSON.stringify(cache[name] || {}, null, 2));
    } catch {}
    delete writeQueues[name];
  }, 500);
}

function get(table, key) {
  const db = loadTable(table);
  return db[key] ?? null;
}

function set(table, key, value) {
  const db = loadTable(table);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    db[key] = { ...(db[key] || {}), ...value };
  } else {
    db[key] = value;
  }
  saveTable(table);
}

function del(table, key) {
  const db = loadTable(table);
  delete db[key];
  saveTable(table);
}

function getAll(table) {
  return loadTable(table);
}

// ── Force flush all pending writes (call on shutdown) ────────
function flushAll() {
  for (const name of Object.keys(writeQueues)) {
    clearTimeout(writeQueues[name]);
    try {
      fs.writeFileSync(dbFile(name), JSON.stringify(cache[name] || {}, null, 2));
    } catch {}
  }
}

process.on('exit', flushAll);
process.on('SIGINT', () => { flushAll(); process.exit(); });
process.on('SIGTERM', () => { flushAll(); process.exit(); });

// ============================================================
// DATABASE API — Same interface as before, no changes needed
// ============================================================
const Database = {

  // ── Users ──────────────────────────────────────────────────
  async getUser(jid) {
    return get('users', jid);
  },
  async setUser(jid, data) {
    set('users', jid, data);
  },
  async updateUser(jid, data) {
    set('users', jid, data);
  },

  // ── Economy ────────────────────────────────────────────────
  async getBalance(jid) {
    const user = get('users', jid);
    return user ? (user.balance || 0) : 0;
  },
  async addBalance(jid, amount) {
    const user = get('users', jid) || { balance: 0 };
    set('users', jid, { balance: (user.balance || 0) + amount });
  },
  async removeBalance(jid, amount) {
    const user = get('users', jid) || { balance: 0 };
    const newBal = Math.max(0, (user.balance || 0) - amount);
    set('users', jid, { balance: newBal });
    return newBal;
  },

  // ── Groups ─────────────────────────────────────────────────
  async getGroup(groupId) {
    return get('groups', groupId) || {};
  },
  async setGroup(groupId, data) {
    set('groups', groupId, data);
  },

  // ── Warns ──────────────────────────────────────────────────
  async getWarns(jid, groupId) {
    const key = `${groupId}_${jid}`;
    const data = get('warns', key);
    return data ? (data.warns || 0) : 0;
  },
  async addWarn(jid, groupId, reason) {
    const key = `${groupId}_${jid}`;
    const data = get('warns', key) || { warns: 0, reasons: [] };
    const warns = (data.warns || 0) + 1;
    set('warns', key, {
      warns,
      reasons: [...(data.reasons || []), reason],
    });
    return warns;
  },
  async resetWarns(jid, groupId) {
    del('warns', `${groupId}_${jid}`);
  },

  // ── Banned ─────────────────────────────────────────────────
  async isBanned(jid) {
    return get('banned', jid) !== null;
  },
  async banUser(jid) {
    set('banned', jid, { banned: true, at: Date.now() });
  },
  async unbanUser(jid) {
    del('banned', jid);
  },

  // ── Blacklist ──────────────────────────────────────────────
  async getBlacklist(groupId) {
    const data = get('blacklist', groupId);
    return data ? (data.words || []) : [];
  },
  async addBlacklist(groupId, word) {
    const data = get('blacklist', groupId) || { words: [] };
    const words = [...new Set([...(data.words || []), word.toLowerCase()])];
    set('blacklist', groupId, { words });
  },
  async removeBlacklist(groupId, word) {
    const data = get('blacklist', groupId) || { words: [] };
    set('blacklist', groupId, {
      words: (data.words || []).filter(w => w !== word.toLowerCase()),
    });
  },

  // ── Activity ───────────────────────────────────────────────
  async logActivity(jid, groupId) {
    const key = `${groupId}_${jid}`;
    const data = get('activity', key) || { jid, groupId, count: 0 };
    set('activity', key, {
      jid,
      groupId,
      count: (data.count || 0) + 1,
      last: Date.now(),
    });
  },
  async getGroupActivity(groupId) {
    const all = getAll('activity');
    return Object.values(all)
      .filter(d => d.groupId === groupId)
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 10);
  },

  // ── AFK ────────────────────────────────────────────────────
  async setAFK(jid, reason) {
    set('afk', jid, { reason, since: Date.now() });
  },
  async getAFK(jid) {
    return get('afk', jid);
  },
  async removeAFK(jid) {
    del('afk', jid);
  },

  // ── Cards ──────────────────────────────────────────────────
  async getCards(jid) {
    const data = get('cards', jid);
    return data ? (data.cards || []) : [];
  },
  async addCard(jid, card) {
    const data = get('cards', jid) || { cards: [] };
    set('cards', jid, { cards: [...(data.cards || []), card] });
  },

  // ── Richlist ───────────────────────────────────────────────
  async getRichlist(groupId) {
    const all = getAll('users');
    return Object.entries(all)
      .map(([jid, u]) => ({ jid, ...u }))
      .filter(u => u.registered)
      .sort((a, b) => (b.balance || 0) - (a.balance || 0))
      .slice(0, 10);
  },
  async getGlobalRichlist() {
    const all = getAll('users');
    return Object.entries(all)
      .map(([jid, u]) => ({ jid, ...u }))
      .filter(u => u.registered)
      .sort((a, b) => (b.balance || 0) - (a.balance || 0))
      .slice(0, 10);
  },

  // ── Stardust ───────────────────────────────────────────────
  async getStardust(jid) {
    const user = get('users', jid);
    return user ? (user.stardust || 0) : 0;
  },
  async addStardust(jid, amount) {
    const user = get('users', jid) || { stardust: 0 };
    set('users', jid, { stardust: (user.stardust || 0) + amount });
  },

  // ── Spawn cards ────────────────────────────────────────────
  async setSpawn(spawnId, data) {
    set('spawns', spawnId, data);
  },
  async getSpawn(spawnId) {
    return get('spawns', spawnId);
  },
  async getSpawnByShortId(shortId) {
    const all = getAll('spawns');
    const found = Object.entries(all).find(([, d]) =>
      d.shortId === shortId.toUpperCase() && !d.claimed
    );
    if (!found) return null;
    return { id: found[0], ...found[1] };
  },
  async claimSpawn(spawnDocId) {
    set('spawns', spawnDocId, { claimed: true, claimedAt: Date.now() });
  },

  // ── Daily cooldown ─────────────────────────────────────────
  async getDailyCooldown(jid) {
    const data = get('cooldowns', `daily_${jid}`);
    return data ? data.timestamp : 0;
  },
  async setDailyCooldown(jid) {
    set('cooldowns', `daily_${jid}`, { timestamp: Date.now() });
  },

  // ── Generic cooldown ───────────────────────────────────────
  async getCooldown(key) {
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '_');
    const data = get('cooldowns', safeKey);
    return data ? data.timestamp : 0;
  },
  async setCooldown(key, timestamp) {
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '_');
    set('cooldowns', safeKey, { timestamp });
  },

  // ── Sudo list ──────────────────────────────────────────────
  async getSudoList() {
    const data = get('config', 'sudo');
    return data ? (data.numbers || []) : [];
  },
  async addSudo(number) {
    const data = get('config', 'sudo') || { numbers: [] };
    const numbers = [...new Set([...(data.numbers || []), number])];
    set('config', 'sudo', { numbers });
  },
  async removeSudo(number) {
    const data = get('config', 'sudo') || { numbers: [] };
    set('config', 'sudo', {
      numbers: (data.numbers || []).filter(n => n !== number),
    });
  },
};

// Stub for any code still referencing admin or db directly
const db = { get, set, del, getAll };
const admin = {
  firestore: {
    FieldValue: {
      increment: n => n,
      arrayUnion: (...a) => a,
      arrayRemove: () => [],
    },
  },
};

module.exports = { db, admin, Database };
