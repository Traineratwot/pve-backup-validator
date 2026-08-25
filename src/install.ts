import prompts from "prompts";
import { writeFileSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

function timeToCron(time: string): string {
  const [h, m] = time.split(":");
  return `${parseInt(m)} ${parseInt(h)} * * *`;
}

async function run() {
  console.log("=== PVE Backup Validator — Setup ===\n");
  console.log(
    "This script will configure the backup validator for your Proxmox VE cluster.\n"
  );

  const response = await prompts(
    [
      {
        type: "text",
        name: "pveHost",
        message: "PVE host IP or hostname (primary node):",
        validate: (v) => (v.trim() ? true : "Required"),
      },
      {
        type: "text",
        name: "snapshotStorage",
        message:
          "Snapshot-capable storage names (comma-separated, e.g. local-zfs,fast-zfs):",
        initial: "local-zfs",
        validate: (v) => (v.trim() ? true : "Required"),
      },
      {
        type: "text",
        name: "backupTarget",
        message: "Backup target storage name:",
        initial: "PBS",
        validate: (v) => (v.trim() ? true : "Required"),
      },
      {
        type: "text",
        name: "snapshotTime",
        message: "Snapshot backup time (HH:MM, 24h):",
        initial: "03:00",
        validate: (v) =>
          /^\d{1,2}:\d{2}$/.test(v) ? true : "Format: HH:MM",
      },
      {
        type: "text",
        name: "stopTime",
        message: "Stop backup time (HH:MM, 24h):",
        initial: "06:30",
        validate: (v) =>
          /^\d{1,2}:\d{2}$/.test(v) ? true : "Format: HH:MM",
      },
      {
        type: "confirm",
        name: "installCron",
        message: "Install hourly cron job now?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        console.log("\nSetup cancelled.");
        process.exit(0);
      },
    }
  );

  const snapshotStorage = response.snapshotStorage
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const config = {
    pveHost: response.pveHost.trim(),
    snapshotStorage,
    backupTarget: response.backupTarget.trim(),
    schedule: {
      snapshot: timeToCron(response.snapshotTime),
      stop: timeToCron(response.stopTime),
    },
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`\nConfig written to config.json`);

  if (response.installCron) {
    await import("./install-cron.js");
  } else {
    console.log("\nTo install cron later: bun run install:cron");
  }

  console.log("\nSetup complete. Run `bun run start` to execute.");
}

run();
