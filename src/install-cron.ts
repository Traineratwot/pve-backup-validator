const JOB_TITLE = "pve-backup-validator";
const SCHEDULE = "@hourly";

console.log(`Installing cron job "${JOB_TITLE}" with schedule "${SCHEDULE}"...`);

await Bun.cron("./src/cron-handler.ts", SCHEDULE, JOB_TITLE);

console.log("Done! Cron job registered.");
console.log("View with: crontab -l");
console.log("Remove with: bun run uninstall:cron");
