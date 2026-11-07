const { callAI, checkAndIncrementQuota } = require('../utils');

const MAX_DIFF_CHARS = 30000;
const MAX_CONTEXT_FILES = 2;
const MAX_FILE_CHARS = 12000;

module.exports = async (context) => {
  const { pull_request: pr, repository } = context.payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const username = pr.user.login;

  try {
    const quota = await checkAndIncrementQuota(username);
    if (!quota.allowed) return;

    const diffRes = await context.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pr.number,
      mediaType: { format: 'diff' },
    });
    const diffText = String(diffRes.data || '').slice(0, MAX_DIFF_CHARS);

    let contextCode = '';
    try {
      const filesRes = await context.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pr.number,
        per_page: MAX_CONTEXT_FILES,
      });
      const parts = [];
      for (const file of filesRes.data.slice(0, MAX_CONTEXT_FILES)) {
        if (file.status === 'removed') continue;
        try {
          const contentRes = await context.octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.filename,
            ref: pr.head.sha,
          });
          const content = contentRes.data;
          if (!content || content.encoding !== 'base64' || !content.content) continue;
          const text = Buffer.from(content.content, 'base64')
            .toString('utf8')
            .slice(0, MAX_FILE_CHARS);
          parts.push(`// ${file.filename}\n${text}`);
        } catch (e) {
          continue;
        }
      }
      contextCode = parts.join('\n\n');
    } catch (e) {
      contextCode = '';
    }

    let ciStatus = '未知';
    try {
      const checksRes = await context.octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: pr.head.sha,
        per_page: 20,
      });
      if (checksRes.data.check_runs.length > 0) {
        ciStatus = checksRes.data.check_runs
          .map((check) => `${check.name}: ${check.conclusion || check.status}`)
          .join('\n');
      }
    } catch (e) {
      ciStatus = '未知';
    }

    const prompt = `你是高级代码审查专家。请结合 Diff、上下文和 CI 状态审查 PR。
【CI 状态】: ${ciStatus}
【Diff】: ${diffText}
【上下文代码】: ${contextCode}
指出：1) 潜在 Bug；2) 对上下文逻辑的影响；3) 可能引发 CI 失败的原因。`;

    const review = await callAI(prompt);

    await context.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pr.number,
      body: `## AI 审查（@${username}，剩余 ${quota.remaining} 次）\n\n${review}`,
    });

    context.log.info(`PR #${pr.number} 已审查，配额剩余: ${quota.remaining}`);
  } catch (error) {
    context.log.error(`PR #${pr.number} 审查失败: ${error.message}`);
  }
};
