const {
  callAI,
  checkAndIncrementQuota,
  getCached,
  setCache,
  sha256,
  parseAIJson,
  DAILY_LIMIT_PER_USER,
} = require('../utils');

module.exports = async (context) => {
  const { issue, repository } = context.payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const username = issue.user.login;

  try {
    const quota = await checkAndIncrementQuota(username);
    if (!quota.allowed) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `@${username} 今日 AI 额度已用完（每日上限 ${DAILY_LIMIT_PER_USER} 次），请明天再试。`,
      });
      return;
    }

    const cacheKey = sha256(`${issue.title}${issue.body || ''}`);
    let raw = await getCached(cacheKey);

    if (!raw) {
      const prompt = `分析以下 Issue 并返回 JSON：
{ "analysis": "技术分析（bug/enhancement/question 等）", "labels": ["推荐标签"] }
标题: ${issue.title}
内容: ${issue.body || '（无内容）'}
推荐标签候选：bug, enhancement, question, documentation, good first issue`;
      raw = await callAI(prompt);
      await setCache(cacheKey, raw);
    }

    const parsed = parseAIJson(raw);
    const analysis = parsed && parsed.analysis ? parsed.analysis : raw;
    const labels = parsed && Array.isArray(parsed.labels) ? parsed.labels.filter(Boolean) : [];

    if (labels.length > 0) {
      await context.octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issue.number,
        labels,
      });
    }

    await context.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: `### Issue 分析\n\n${analysis}\n\n---\n剩余额度：${quota.remaining} 次`,
    });

    context.log.info(`Issue #${issue.number} 已处理，配额剩余: ${quota.remaining}`);
  } catch (error) {
    context.log.error(`Issue #${issue.number} 处理失败: ${error.message}`);
  }
};
