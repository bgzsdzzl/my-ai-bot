const {
  callAI,
  checkAndIncrementQuota,
  mentionRegex,
  parseAIJson,
  DAILY_LIMIT_PER_USER,
} = require('../utils');

module.exports = async (context) => {
  const { comment, issue, repository } = context.payload;
  if (comment.user.type === 'Bot') return;
  if (!comment.body) return;

  const re = mentionRegex();
  if (!re.test(comment.body)) return;

  const instruction = comment.body.replace(re, '').trim();
  const owner = repository.owner.login;
  const repo = repository.name;
  const username = comment.user.login;

  try {
    if (!instruction) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `👋hello,I`m**${process.env.BOT_NAME}**。`,
      });
      return;
    }

    if (instruction.includes('read all')) return;

    const quota = await checkAndIncrementQuota(username);
    if (!quota.allowed) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `@${username} ${process.env.BOT_NAME}并不是无限使用的，每天仅能请求${process.env.BOT_NAME} ${DAILY_LIMIT_PER_USER} 次`,
      });
      return;
    }

    const prompt = `你是资深极客，性格有点高冷但技术极强，现在你是这个仓库的专属助手。
用户 @${username} 在 #${issue.number} 中向你提问。
Issue 标题: ${issue.title}
用户指令: ${instruction}
如果需要打标签，严格返回 JSON 格式：{ "reply": "...", "labels": ["..."] }
否则直接用纯文本回答。`;

    const raw = await callAI(prompt);
    const parsed = parseAIJson(raw);

    let reply = raw;
    let labels = [];
    if (parsed && typeof parsed.reply === 'string') {
      reply = parsed.reply;
      labels = Array.isArray(parsed.labels) ? parsed.labels.filter(Boolean) : [];
    }

    if (labels.length > 0) {
      await context.octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issue.number,
        labels,
      });
};
