import { join } from "path";

const JOB_TITLE = "pve-backup-validator";
const SCHEDULE = "@hourly";
const HANDLER = join(import.meta.dir, "cron-handler.ts");

console.log(`Installing cron job "${JOB_TITLE}" with schedule "${SCHEDULE}"...`);

await Bun.cron(HANDLER, SCHEDULE, JOB_TITLE);

console.log("Done! Cron job registered.");
console.log("View with: crontab -l");
console.log("Remove with: bun run uninstall:cron");
