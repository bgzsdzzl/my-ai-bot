export default {
  async scheduled(event, env, ctx) {
    const urls = [
      'https://你的InstaBox公网地址/ping',
    ];
    for (const url of urls) {
      try { await fetch(url, { signal: AbortSignal.timeout(10000) }); } catch (e) {}
    }
  },
};
