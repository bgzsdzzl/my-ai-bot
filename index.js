require('dotenv').config();
const { Probot } = require('probot');

// 添加 getRouter 参数
module.exports = (app, { getRouter }) => {
  // 手动实现 /ping 路由
  const router = getRouter();
  router.get('/ping', (req, res) => {
    res.status(200).send('pong');
  });

  // 原有的事件注册
  app.on('issues.opened', require('./handlers/issueOpened'));
  app.on('issue_comment.created', require('./handlers/mention'));
  app.on('pull_request.opened', require('./handlers/prReview'));
  app.on('pull_request.synchronize', require('./handlers/prReview'));
  app.on('issue_comment.created', require('./handlers/fullRepoReview'));
  app.on('release.published', require('./handlers/release'));
};