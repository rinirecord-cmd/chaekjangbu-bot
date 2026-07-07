require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client } = require('@notionhq/client');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!TELEGRAM_TOKEN || !NOTION_TOKEN || !DATABASE_ID) {
  console.error('환경변수(.env)에 TELEGRAM_BOT_TOKEN / NOTION_TOKEN / NOTION_DATABASE_ID를 모두 채워주세요.');
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_TOKEN);
const notion = new Client({ auth: NOTION_TOKEN });

// 채팅방별로 "사진은 왔는데 정보는 덜 채워진" 상태를 잠깐 기억해두는 저장소
const pending = new Map();

// 진단용: 최근 이벤트를 메모리에 보관 (서버 로그 대신 /debug 로 확인)
const recentLogs = [];
function logEvent(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  recentLogs.push(line);
  if (recentLogs.length > 60) recentLogs.shift();
}

// 들어오는 모든 업데이트를 가장 먼저 기록 (핸들러 도달 여부 확인용)
bot.use((ctx, next) => {
  logEvent(`업데이트 수신: type=${ctx.updateType}`);
  return next();
});

const FIELD_LABELS = {
  title: ['제목', '책제목', '타이틀'],
  price: ['가격', '금액', '값'],
  publisher: ['출판사'],
  author: ['작가', '저자'],
  type: ['유형', '장르'],
};

const FIELD_ORDER = ['title', 'price', 'publisher', 'author', 'type'];
const FIELD_DISPLAY = {
  title: '제목',
  price: '가격',
  publisher: '출판사',
  author: '작가',
  type: '유형',
};

function parseFields(text) {
  const result = {};
  if (!text) return result;
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*([^:：\-]{1,10})\s*[:：\-]\s*(.+?)\s*$/);
    if (!match) continue;
    const [, rawLabel, rawValue] = match;
    const label = rawLabel.trim();
    const value = rawValue.trim();
    if (!value) continue;
    for (const key of FIELD_ORDER) {
      if (FIELD_LABELS[key].includes(label)) {
        result[key] = value;
        break;
      }
    }
  }
  return result;
}

function missingFields(fields) {
  return FIELD_ORDER.filter((key) => !fields[key]);
}

function formatTemplate(fields = {}) {
  return FIELD_ORDER.map((key) => `${FIELD_DISPLAY[key]}: ${fields[key] || ''}`).join('\n');
}

function getState(chatId) {
  return pending.get(chatId) || { fields: {} };
}

function todayISODate() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parsePrice(raw) {
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
}

async function finalizeEntry(ctx, chatId, state) {
  logEvent(`저장 시도 chat_id=${chatId} fields=${JSON.stringify(state.fields)}`);
  const price = parsePrice(state.fields.price);
  if (price === null) {
    await ctx.reply('가격은 숫자로 다시 알려주세요. 예) 가격: 15000');
    return;
  }

  try {
    let coverUrl = null;
    if (state.photoFileId) {
      logEvent('getFileLink 시도...');
      const link = await ctx.telegram.getFileLink(state.photoFileId);
      coverUrl = typeof link === 'string' ? link : link.href;
      logEvent('getFileLink 성공 (URL 길이=' + String(coverUrl).length + ')');
    }

    const properties = {
      제목: { title: [{ text: { content: state.fields.title } }] },
      구매일: { date: { start: todayISODate() } },
      가격: { number: price },
      유형: { select: { name: state.fields.type } },
      작가: { rich_text: [{ text: { content: state.fields.author } }] },
      출판사: { rich_text: [{ text: { content: state.fields.publisher } }] },
    };

    if (coverUrl) {
      properties.표지 = {
        files: [{ type: 'external', name: '표지', external: { url: coverUrl } }],
      };
    }

    const page = await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties,
    });

    pending.delete(chatId);
    logEvent('저장 성공 → ' + page.url);

    const summary = FIELD_ORDER.map((key) => `${FIELD_DISPLAY[key]}: ${state.fields[key]}`).join('\n');
    await ctx.reply(`✅ 책 장부에 기록했어요!\n\n${summary}\n\n${page.url || ''}`);
  } catch (err) {
    logEvent('❌ 저장 실패: ' + (err.body ? JSON.stringify(err.body) : (err.message || String(err))));
    await ctx.reply(
      '노션에 저장하는 중 문제가 생겼어요. 잠시 후 다시 시도해주시거나, 형식이 올바른지 확인해주세요.\n\n' +
        formatTemplate(state.fields)
    );
  }
}

async function sendGuide(ctx, state) {
  const missing = missingFields(state.fields);
  const captured = FIELD_ORDER.filter((key) => state.fields[key]);

  let msg = '';
  if (captured.length) {
    msg += '지금까지 받은 정보예요:\n';
    msg += captured.map((key) => `✅ ${FIELD_DISPLAY[key]}: ${state.fields[key]}`).join('\n');
    msg += '\n\n';
  }
  if (!state.photoFileId) {
    msg += '📸 책 표지 사진을 보내주세요.\n\n';
  }
  if (missing.length) {
    msg += '아래 형식으로 나머지 정보를 알려주세요:\n';
    msg += missing.map((key) => `${FIELD_DISPLAY[key]}: `).join('\n');
  }
  await ctx.reply(msg.trim());
}

bot.start(async (ctx) => {
  pending.delete(ctx.chat.id);
  await ctx.reply(
    '📚 책 장부 봇이에요!\n\n' +
      '책을 사면 표지 사진과 함께, 또는 사진을 먼저 보내고 아래 형식으로 답장해주세요:\n\n' +
      formatTemplate() +
      '\n\n사진 캡션에 저 형식을 한 번에 써서 보내도 되고, 사진만 먼저 보내면 제가 나머지를 물어볼게요.'
  );
});

bot.command('cancel', async (ctx) => {
  pending.delete(ctx.chat.id);
  await ctx.reply('입력하던 내용을 취소했어요. 다시 사진을 보내주세요 📸');
});

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  logEvent(`사진 수신 chat_id=${chatId} caption=${JSON.stringify(ctx.message.caption || '')}`);
  const state = getState(chatId);

  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id;
  state.photoFileId = fileId;

  const captionFields = parseFields(ctx.message.caption || '');
  state.fields = { ...state.fields, ...captionFields };

  pending.set(chatId, state);

  if (missingFields(state.fields).length === 0) {
    await finalizeEntry(ctx, chatId, state);
  } else {
    await sendGuide(ctx, state);
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const chatId = ctx.chat.id;
  const parsed = parseFields(text);

  if (Object.keys(parsed).length === 0 && !pending.has(chatId)) {
    await ctx.reply('먼저 책 표지 사진을 보내주세요 📸\n형식이 궁금하면 /start 를 입력해주세요.');
    return;
  }

  const state = getState(chatId);
  state.fields = { ...state.fields, ...parsed };
  pending.set(chatId, state);

  if (state.photoFileId && missingFields(state.fields).length === 0) {
    await finalizeEntry(ctx, chatId, state);
  } else {
    await sendGuide(ctx, state);
  }
});

bot.catch((err, ctx) => {
  logEvent('봇 처리 중 에러: ' + (err && (err.message || String(err))));
});

const WEBHOOK_URL = process.env.WEBHOOK_URL; // 예: https://내앱.onrender.com
const PORT = process.env.PORT || 3000;

// 테스트에서 require할 수 있도록 export (직접 실행할 때만 launch)
module.exports = { bot, parseFields, missingFields, FIELD_ORDER };

if (require.main !== module) {
  // 다른 파일에서 require한 경우(테스트) — launch하지 않고 핸들러만 노출.
} else if (WEBHOOK_URL) {
  // 배포(클라우드) 환경: express + telegraf webhook.
  // 핵심: botInfo를 명시적으로 초기화해야 메시지가 핸들러로 전달된다(이게 빠져서 안 됐음).
  // 추가로 /debug 엔드포인트로 최근 처리 로그를 외부에서 확인할 수 있게 한다.
  const express = require('express');
  const domain = WEBHOOK_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const app = express();
  const DEBUG_KEY = TELEGRAM_TOKEN.slice(-8);

  app.get('/', (_req, res) => res.send('책 장부 봇 살아있음'));
  app.get('/debug', (req, res) => {
    if (req.query.key !== DEBUG_KEY) return res.status(403).send('forbidden');
    res.json({ botInfoLoaded: !!bot.botInfo, logs: recentLogs });
  });

  (async () => {
    try {
      bot.botInfo = await bot.telegram.getMe(); // ★ 명시적 초기화
      logEvent('botInfo 초기화 완료: @' + bot.botInfo.username);
      app.use(await bot.createWebhook({ domain }));
      app.listen(Number(PORT), '0.0.0.0', () => {
        logEvent(`웹훅 모드 시작 (domain=${domain}, port=${PORT})`);
      });
    } catch (e) {
      logEvent('❌ 시작 실패: ' + (e.message || String(e)));
      console.error(e);
    }
  })();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  // 로컬 개발/테스트용: 폴링 모드.
  // 주의: telegraf의 bot.launch()가 반환하는 Promise는 봇이 "멈출 때" resolve된다.
  // 그래서 시작 알림은 onLaunch 콜백으로 찍는다.
  bot.launch(() => {
    console.log(`[${new Date().toISOString()}] 책 장부 봇이 실행 중입니다 (polling 모드).`);
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
