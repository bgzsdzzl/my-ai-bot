const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const turso = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

const DAILY_LIMIT_PER_USER = 15;

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isWhitelisted(username) {
  const list = (process.env.WHITELIST_USERS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(username || '').toLowerCase());
}

function mentionRegex() {
  const botName = process.env.BOT_NAME || 'github-ai-bot';
  const escaped = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 关键：加上 (?:\\[bot\\])? 匹配 GitHub 自动添加的 [bot] 后缀
  return new RegExp(`@${escaped}(?:\\[bot\\])?`, 'gi');
}

function parseAIJson(text) {
  if (!text) return null;
  let content = String(text).trim();
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) content = fence[1].trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

async function callAI(prompt, model = '@cf/meta/llama-3-8b-instruct') {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/${model}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: '你是专业的代码审查助手。请严格按要求回答，不要输出多余废话。',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const data = await res.json();
  if (!data || !data.success) {
    const detail = data && Array.isArray(data.errors)
      ? data.errors.map((item) => item.message).join('; ')
      : `HTTP ${res.status}`;
    throw new Error(`Cloudflare AI 调用失败: ${detail}`);
  }
  return data.result.response;
}

async function incrementKV(key) {
  const result = await turso.execute({
    sql: `INSERT INTO kv_store (key, value) VALUES (?, '1')
          ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
          RETURNING value`,
    args: [key],
  });
  return Number(result.rows[0].value);
}

async function checkAndIncrementQuota(username) {
  const used = await incrementKV(`quota:${todayUTC()}:${username}`);
  return {
    allowed: used <= DAILY_LIMIT_PER_USER,
    remaining: Math.max(0, DAILY_LIMIT_PER_USER - used),
  };
}

async function getCached(cacheKey) {
  const rs = await turso.execute({
    sql: 'SELECT response_body FROM ai_cache WHERE cache_key = ?',
    args: [cacheKey],
  });
  return rs.rows.length > 0 ? rs.rows[0].response_body : null;
}

async function setCache(cacheKey, body) {
  await turso.execute({
    sql: `INSERT INTO ai_cache (cache_key, response_body) VALUES (?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET response_body = excluded.response_body, created_at = unixepoch()`,
    args: [cacheKey, body],
  });
}

async function getRepoTree(octokit, owner, repo) {
  const res = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: 'HEAD',
    recursive: 'true',
  });
  return res.data.tree;
}

module.exports = {
  turso,
  DAILY_LIMIT_PER_USER,
  todayUTC,
  sha256,
  isWhitelisted,
  mentionRegex,
  parseAIJson,
  callAI,
  incrementKV,
  checkAndIncrementQuota,
  getCached,
  setCache,
  getRepoTree,
};
