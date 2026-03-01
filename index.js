const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
  makeInMemoryStore,
} = require('@whiskeysockets/baileys');
const pino       = require('pino');
const { Boom }   = require('@hapi/boom');
const fs         = require('fs');
const path       = require('path');
const readline   = require('readline');
const config     = require('./config');
const { messageHandler, handleGroupUpdate } = require('./src/handlers/messageHandler');

// ── Folders ───────────────────────────────────────────────────
const SESSION_FOLDER = path.join(__dirname, 'sessions');
const TEMP_FOLDER    = path.join(__dirname, 'temp');
const ASSETS_FOLDER  = path.join(__dirname, 'assets');
[SESSION_FOLDER, TEMP_FOLDER, ASSETS_FOLDER].forEach(f => {
  if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
});

const logger = pino({ level: 'silent' });

// ── Globals ───────────────────────────────────────────────────
let currentSock      = null;   // the ONE active socket at any time
let isConnected      = false;
let reconnectTimer   = null;
let reconnectCount   = 0;
let isStarting       = false;

// ── Ask the user a question in terminal ───────────────────────
function ask(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ── Schedule a reconnect ──────────────────────────────────────
function scheduleReconnect(delayMs) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    isStarting     = false;
    startBot();
  }, delayMs);
}

// ═══════════════════════════════════════════════════════════════
//  START BOT
//
//  The core fix: sock.ev.removeAllListeners() before creating a
//  new socket means we NEVER accumulate duplicate event handlers
//  across reconnects. Each reconnect = exactly one handler set.
// ═══════════════════════════════════════════════════════════════
async function startBot() {
  if (isStarting) return;
  isStarting  = true;
  isConnected = false;

  // ── Destroy the old socket fully before making a new one ──
  if (currentSock) {
    try {
      currentSock.ev.removeAllListeners(); // kills ALL stale listeners
      currentSock.ws?.close();             // closes the WebSocket
    } catch {}
    currentSock = null;
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version }          = await fetchLatestBaileysVersion();

    // Fresh store every reconnect — stale store can block message delivery
    const store = makeInMemoryStore({ logger });

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser:                        Browsers.ubuntu('Chrome'),
      printQRInTerminal:              false,   // NO QR — pairing code only
      generateHighQualityLinkPreview: false,
      syncFullHistory:                false,
      markOnlineOnConnect:            false,
      keepAliveIntervalMs:            25_000,
      retryRequestDelayMs:            3_000,
      connectTimeoutMs:               60_000,
      defaultQueryTimeoutMs:          60_000,
      getMessage: async (key) => {
        try {
          const m = await store.loadMessage(key.remoteJid, key.id);
          return m?.message ?? { conversation: '' };
        } catch { return { conversation: '' }; }
      },
    });

    currentSock = sock;
    store.bind(sock.ev);

    // ── CONNECTION UPDATES ────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

      // Ignore QR codes — we never use QR, only pairing codes
      if (qr) return;

      if (connection === 'close') {
        isConnected = false;
        isStarting  = false;

        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log(`\n🔌 Connection closed — code: ${statusCode}`);

        switch (statusCode) {
          case DisconnectReason.loggedOut:
            console.log('🔴 Logged out. Wiping session for fresh pairing…\n');
            try {
              fs.readdirSync(SESSION_FOLDER)
                .forEach(f => fs.unlinkSync(path.join(SESSION_FOLDER, f)));
            } catch {}
            scheduleReconnect(2_000);
            break;

          case DisconnectReason.connectionReplaced:
            console.log('⚠️  Connection replaced by another session. Reconnecting…\n');
            scheduleReconnect(3_000);
            break;

          case DisconnectReason.timedOut:
          case DisconnectReason.connectionLost:
          case DisconnectReason.connectionClosed:
            reconnectCount++;
            console.log(`🔄 Network issue. Retry ${reconnectCount} in ${Math.min(3 * reconnectCount, 20)}s…`);
            scheduleReconnect(Math.min(3_000 * reconnectCount, 20_000));
            break;

          default:
            reconnectCount++;
            console.log(`🔄 Disconnected (${statusCode}). Retry ${reconnectCount}…`);
            scheduleReconnect(Math.min(5_000 * reconnectCount, 30_000));
        }

      } else if (connection === 'open') {
        isConnected    = true;
        isStarting     = false;
        reconnectCount = 0;

        const botNum = (sock.user?.id ?? '').split(':')[0].split('@')[0];
        console.log('\n✅ ════════════════════════════════════');
        console.log('   🌸 Shadow Garden Bot is ONLINE!');
        console.log(`   📱 Bot: +${botNum}`);
        console.log('════════════════════════════════════\n');
      }
    });

    // ── PAIRING CODE — only when no session exists ────────────
    if (!state.creds.registered) {
      // Give the WebSocket time to open before requesting code
      await new Promise(r => setTimeout(r, 3_000));

      console.log('\n┌──────────────────────────────────────┐');
      console.log('│       🌸 SHADOW GARDEN BOT SETUP      │');
      console.log('└──────────────────────────────────────┘\n');
      console.log('Enter your WhatsApp number WITH country code.');
      console.log('No +, no spaces, no dashes.');
      console.log('Example: 2349049460676\n');

      let phoneNumber = '';
      while (phoneNumber.length < 7) {
        phoneNumber = (await ask('📱 Number: ')).replace(/\D/g, '');
        if (phoneNumber.length < 7) console.log('❌ Too short — try again.\n');
      }

      await new Promise(r => setTimeout(r, 2_000));

      try {
        const code = await sock.requestPairingCode(phoneNumber);
        const fmt  = code?.match(/.{1,4}/g)?.join('-') ?? code;

        console.log('\n┌──────────────────────────────────────┐');
        console.log(`│   🔑 YOUR CODE: ${fmt.padEnd(20)}│`);
        console.log('└──────────────────────────────────────┘\n');
        console.log('Steps:');
        console.log('  1. Open WhatsApp on your phone');
        console.log('  2. Settings → Linked Devices → Link a Device');
        console.log('  3. Tap "Link with phone number instead"');
        console.log(`  4. Enter: ${fmt}\n`);
        console.log('⏳ Waiting for pairing…\n');

      } catch (err) {
        console.error('❌ Pairing code error:', err?.message ?? err);
        console.log('Restarting in 5s…\n');
        isStarting = false;
        scheduleReconnect(5_000);
        return;
      }
    }

    // ── SAVE CREDS ON EVERY UPDATE ────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── MESSAGE HANDLER ───────────────────────────────────────
    //
    // ★ WHY THIS WORKS AFTER MANY RECONNECTS ★
    //
    // Problem 1 — Duplicate listeners:
    //   Each reconnect used to ADD a new messages.upsert listener to a new
    //   sock without removing the old sock's listeners. After 3+ reconnects
    //   you had multiple handlers running simultaneously — some on a dead
    //   socket, causing races, double-processing, and missed commands.
    //   FIX: sock.ev.removeAllListeners() at the top of startBot() means
    //   there is always exactly ONE handler active at a time.
    //
    // Problem 2 — isConnected gate:
    //   Baileys fires messages.upsert BEFORE connection.update fires 'open'.
    //   If we check isConnected === true before processing, the very first
    //   messages after reconnect get silently dropped.
    //   FIX: We NEVER check isConnected in this handler.
    //
    // Problem 3 — Backlog replay:
    //   On reconnect WhatsApp may replay messages from while offline.
    //   FIX: Drop messages older than 30 seconds. Real-time messages are
    //   always < 1s old; offline backlog is much older.
    //
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message)   continue;   // empty shell, skip
        if (msg.key.fromMe) continue;   // bot's own outgoing, skip

        // Drop stale backlog — keep everything real-time
        const ageMs = Date.now() - (Number(msg.messageTimestamp) * 1000);
        if (ageMs > 30_000) continue;

        try {
          await messageHandler(sock, msg);
        } catch (err) {
          console.error('⚠️  messageHandler error:', err?.message ?? err);
        }
      }
    });

    // ── GROUP EVENTS ──────────────────────────────────────────
    sock.ev.on('group-participants.update', async (update) => {
      try { await handleGroupUpdate(sock, update); } catch {}
    });

  } catch (err) {
    console.error('⚠️  startBot error:', err?.message ?? err);
    isStarting = false;
    scheduleReconnect(5_000);
  }
}

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
console.log('\n🌸 Starting Shadow Garden Bot…\n');
startBot();

// Watchdog: if nothing is running and nothing is scheduled, restart
setInterval(() => {
  if (!isConnected && !isStarting && !reconnectTimer) {
    console.log('🔄 Watchdog triggered — restarting…');
    startBot();
  }
}, 30_000);

// Never crash the process
process.on('uncaughtException',  err => console.error('Uncaught:', err?.message ?? err));
process.on('unhandledRejection', ()  => {});
