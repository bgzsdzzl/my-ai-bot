const {
  callAI,
  isWhitelisted,
  getRepoTree,
  mentionRegex,
  incrementKV,
  todayUTC,
} = require('../utils');

const FULLREPO_DAILY_LIMIT = 1;
const MAX_FILE_LIST_CHARS = 20000;

module.exports = async (context) => {
  const { comment, issue, repository } = context.payload;
  if (comment.user.type === 'Bot') return;
  if (!comment.body || !comment.body.includes('全仓审查')) return;

  const re = mentionRegex();
  if (!re.test(comment.body)) return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const username = comment.user.login;

  try {
    if (!isWhitelisted(username)) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `@${username} 全仓审查仅限白名单用户。`,
      });
      return;
    }

    const used = await incrementKV(`fullrepo:${todayUTC()}:${username}`);
    if (used > FULLREPO_DAILY_LIMIT) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `@${username} 全仓审查每日限 ${FULLREPO_DAILY_LIMIT} 次，请明天再试。`,
      });
      return;
    }

    await context.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: '正在扫描全仓文件结构...',
    });

    const tree = await getRepoTree(context.octokit, owner, repo);
    const fileList = tree
      .filter((item) => item.type === 'blob')
      .map((item) => item.path)
      .join('\n')
      .slice(0, MAX_FILE_LIST_CHARS);

    const prompt = `仓库完整文件列表：
${fileList}
从架构角度分析：1) 结构是否合理；2) 是否存在分层混乱或耦合问题；3) 建议优先关注哪些目录/文件进行深入审查。`;

    const analysis = await callAI(prompt);

    await context.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: `### 全仓结构分析\n\n${analysis}`,
    });

    context.log.info(`全仓审查完成: ${owner}/${repo}，触发者: ${username}`);
  } catch (error) {
    context.log.error(`全仓审查失败: ${error.message}`);
  }
};
