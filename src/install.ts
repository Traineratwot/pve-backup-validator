import prompts from "prompts";
import { writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

export function timeToCron(time: string): string {
  const [h, m] = time.split(":");
  return `${parseInt(m)} ${parseInt(h)} * * *`;
}

export function hasTool(tool: string): boolean {
  try {
    execSync(`which ${tool}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function checkPrerequisites(mode: "local" | "ssh"): void {
  const missing: string[] = [];

  if (mode === "local" && !hasTool("pvesh")) {
    missing.push("pvesh");
  }
  if (mode === "ssh" && !hasTool("ssh")) {
    missing.push("ssh");
  }

  if (missing.length > 0) {
    console.error(`\nMissing required tools: ${missing.join(", ")}`);
    console.error("Install them and try again.");
    process.exit(1);
  }
}

function getLocalNodeName(): string | null {
  try {
    const result = execSync(
      'pvesh get /nodes/$(hostname)/status --output-format json 2>/dev/null',
      { encoding: "utf-8" }
    );
    const data = JSON.parse(result);
    return data?.name || null;
  } catch {
    return null;
  }
}

function isLocalPrimaryNode(): boolean {
  try {
    const result = execSync(
      'pvesh get /cluster/resources --type node --output-format json 2>/dev/null',
      { encoding: "utf-8" }
    );
    const nodes = JSON.parse(result);
    if (!Array.isArray(nodes) || nodes.length === 0) return false;

    const localName = getLocalNodeName();
    if (!localName) return false;

    const localNode = nodes.find((n: any) => n.node === localName);
    return localNode?.status === "online";
  } catch {
    return false;
  }
}

async function run() {
  console.log("=== PVE Backup Validator — Setup ===\n");

  const pveshAvailable = hasTool("pvesh");

  let mode: "local" | "ssh";

  if (pveshAvailable) {
    const { isLocal } = await prompts(
      {
        type: "confirm",
        name: "isLocal",
        message:
          "pvesh found — are you installing directly on a PVE node?",
        initial: true,
      },
      {
        onCancel: () => {
          console.log("\nSetup cancelled.");
          process.exit(0);
        },
      }
    );

    if (isLocal) {
      if (!isLocalPrimaryNode()) {
        console.error(
          "\nThis node does not appear to be the primary node."
        );
        console.error(
          "Cluster API verification failed. Only the primary node can manage /etc/pve/jobs.cfg."
        );
        process.exit(1);
      }

      const nodeName = getLocalNodeName()!;
      console.log(`\nVerified: ${nodeName} is the primary node.\n`);
      mode = "local";
    } else {
      mode = "ssh";
    }
  } else {
    mode = "ssh";
  }

  checkPrerequisites(mode);

  console.log(
    "This script will configure the backup validator for your Proxmox VE cluster.\n"
  );

  const baseQuestions: any[] = [
    {
      type: mode === "ssh" ? "text" : null,
      name: "pveHost",
      message: "PVE host IP or hostname (primary node):",
      validate: (v: string) => (v.trim() ? true : "Required"),
    },
    {
      type: "text",
      name: "snapshotStorage",
      message:
        "Snapshot-capable storage names (comma-separated, e.g. local-zfs,fast-zfs):",
      initial: "local-zfs",
      validate: (v: string) => (v.trim() ? true : "Required"),
    },
    {
      type: "text",
      name: "backupTarget",
      message: "Backup target storage name:",
      initial: "PBS",
      validate: (v: string) => (v.trim() ? true : "Required"),
    },
    {
      type: "text",
      name: "snapshotTime",
      message: "Snapshot backup time (HH:MM, 24h):",
      initial: "03:00",
      validate: (v: string) =>
        /^\d{1,2}:\d{2}$/.test(v) ? true : "Format: HH:MM",
    },
    {
      type: "text",
      name: "stopTime",
      message: "Stop backup time (HH:MM, 24h):",
      initial: "06:30",
      validate: (v: string) =>
        /^\d{1,2}:\d{2}$/.test(v) ? true : "Format: HH:MM",
    },
    {
      type: "confirm",
      name: "installCron",
      message: "Install hourly cron job now?",
      initial: true,
    },
  ].filter((q) => q.type !== null);

  const response = await prompts(baseQuestions, {
    onCancel: () => {
      console.log("\nSetup cancelled.");
      process.exit(0);
    },
  });

  const snapshotStorage = response.snapshotStorage
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const config: any = {
    mode,
    snapshotStorage,
    backupTarget: response.backupTarget.trim(),
    schedule: {
      snapshot: timeToCron(response.snapshotTime),
      stop: timeToCron(response.stopTime),
    },
  };

  if (mode === "local") {
    config.localNode = getLocalNodeName();
  } else {
    config.pveHost = response.pveHost.trim();
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`\nConfig written to config.json`);

  if (response.installCron) {
    await import("./install-cron.js");
  } else {
    console.log("\nTo install cron later: bun run install:cron");
  }

  console.log("\nSetup complete. Run `bun run start` to execute.");
}

if (import.meta.main) {
  run();
}
