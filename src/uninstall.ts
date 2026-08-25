const JOB_TITLE = "pve-backup-validator";

console.log(`Removing cron job "${JOB_TITLE}"...`);

await Bun.cron.remove(JOB_TITLE);

console.log("Done! Cron job removed.");
