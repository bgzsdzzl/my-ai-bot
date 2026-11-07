const { callAI } = require('../utils');

module.exports = async (context) => {
  const { release, repository } = context.payload;
  const owner = repository.owner.login;
  const repo = repository.name;

  try {
    let baseNotes = '';
    try {
      const res = await context.octokit.rest.repos.generateReleaseNotes({
        owner,
        repo,
        tag_name: release.tag_name,
      });
      baseNotes = res.data.body || '';
    } catch (e) {
      baseNotes = '';
    }

    const prompt = `润色并结构化以下 Release Notes：
${baseNotes}
按「新功能」「Bug 修复」「文档更新」分类，用友好语言重写。如果信息不足，标注「需补充」。`;

    const polished = await callAI(prompt);

    console.log(`[release] ${release.tag_name} 润色结果:\n${polished}`);
  } catch (error) {
    console.error(`[release] ${release.tag_name} 处理失败: ${error.message}`);
  }
};
