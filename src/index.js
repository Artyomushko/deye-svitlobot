import { check } from './check.js';

// Cloudflare Workers: запускається за Cron Trigger.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env).catch((e) => console.error(e.message)));
  },
};
