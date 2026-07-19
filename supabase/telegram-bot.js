/**
 * Syndicate Telegram OTP bot.
 * Required environment variables:
 *   TELEGRAM_BOT_TOKEN
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TELEGRAM_OTP_SECRET
 */

const { createClient } = require('@supabase/supabase-js');
const { createHmac, randomInt } = require('node:crypto');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_OTP_SECRET = process.env.TELEGRAM_OTP_SECRET;

if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_OTP_SECRET) {
  console.error('Missing TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or TELEGRAM_OTP_SECRET.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let lastUpdateId = 0;
const lastOtpIssuedAt = new Map();

function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '') : '';
  return /^[a-z0-9_]{5,32}$/.test(username) ? username : null;
}

function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

function buildOtpDigest(challengeId, otp, issuedAt, telegramUserId) {
  return createHmac('sha256', TELEGRAM_OTP_SECRET)
    .update(`${challengeId}:${otp}:${issuedAt}:${telegramUserId}`)
    .digest('hex');
}

async function telegramApi(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram ${method} failed: ${payload.description || response.status}`);
  }
  return payload.result;
}

async function sendMessage(chatId, text) {
  await telegramApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

async function handleUpdate(update) {
  const message = update?.message;
  if (!message?.text || message.chat?.type !== 'private') return;

  const text = message.text.trim().toLowerCase();
  if (!text.startsWith('/start') && !text.startsWith('/login')) {
    await sendMessage(
      message.chat.id,
      '🤖 <b>Бот авторизации Syndicate</b>\n\nОтправьте /login, чтобы получить одноразовый код.',
    );
    return;
  }

  const username = normalizeUsername(message.from?.username);
  const telegramUserId = String(message.from?.id || '');
  if (!username || !/^\d+$/.test(telegramUserId)) {
    await sendMessage(
      message.chat.id,
      '⚠️ Для входа нужен публичный Telegram Username. Установите его в настройках Telegram и повторите /login.',
    );
    return;
  }

  const previousIssue = lastOtpIssuedAt.get(telegramUserId) || 0;
  if (Date.now() - previousIssue < 30_000) {
    await sendMessage(message.chat.id, '⏳ Новый код можно запросить через несколько секунд.');
    return;
  }
  lastOtpIssuedAt.set(telegramUserId, Date.now());

  const otp = generateOtp();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 10 * 60 * 1000;
  const challengeId = `tg_otp_${username}`;
  const challenge = JSON.stringify({
    version: 2,
    username,
    telegramUserId,
    issuedAt,
    expiresAt,
    otpDigest: buildOtpDigest(challengeId, otp, issuedAt, telegramUserId),
  });

  const { error } = await supabase.from('auth_challenges').upsert({
    id: challengeId,
    challenge,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  await sendMessage(
    message.chat.id,
    `🗝 <b>Код авторизации Syndicate</b>\n\n<code>${otp}</code>\n\nКод одноразовый и действует 10 минут.`,
  );
}

async function pollUpdates() {
  while (true) {
    try {
      const updates = await telegramApi('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 30,
        allowed_updates: ['message'],
      });
      for (const update of updates || []) {
        lastUpdateId = Math.max(lastUpdateId, Number(update.update_id) || 0);
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error('Failed to process Telegram update:', error?.message || error);
        }
      }
    } catch (error) {
      console.error('Telegram polling failed:', error?.message || error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function start() {
  await telegramApi('deleteWebhook', { drop_pending_updates: false });
  console.log('Syndicate Telegram OTP bot started.');
  await pollUpdates();
}

start().catch((error) => {
  console.error('Fatal Telegram bot error:', error?.message || error);
  process.exit(1);
});
