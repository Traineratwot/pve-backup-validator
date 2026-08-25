import { main } from "./index.js";

export default {
  async scheduled(controller: Bun.CronController) {
    console.log(`[${new Date().toISOString()}] Cron fired: ${controller.cron}`);
    await main();
  },
};
