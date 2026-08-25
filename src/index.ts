import { pveExecSafe, pveWriteFile } from "./ssh.js";
import { classifyGuest } from "./classify.js";
import { generateJobsCfg, summarizeJobs } from "./jobs.js";
import { loadConfig } from "./config.js";
import type { ClassifiedGuest } from "./schemas.js";

function log(message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}`;
  console.log(line);
}

interface GuestRef {
  node: string;
  vmid: string;
  type: "ct" | "vm";
}

async function checkRemotePrerequisites(): Promise<void> {
  const { ok, stderr } = await pveExecSafe("which pvesh");
  if (!ok) {
    throw new Error(
      `pvesh not found on ${loadConfig().pveHost}. ` +
        `Ensure SSH access to a Proxmox VE node. ${stderr}`
    );
  }
}

async function getAllGuests(): Promise<GuestRef[]> {
  const guests: GuestRef[] = [];

  const { stdout: clusterJson } = await pveExecSafe(
    `pvesh get /cluster/resources --type vm --output-format json 2>/dev/null`
  );

  if (clusterJson) {
    try {
      const resources = JSON.parse(clusterJson);
      for (const r of resources) {
        guests.push({
          node: r.node,
          vmid: String(r.vmid),
          type: r.type === "qemu" ? "vm" : "ct",
        });
      }
    } catch (e: any) {
      log(`WARN: Failed to parse cluster resources: ${e.message}`);
    }
  }

  return guests;
}

export async function main() {
  const config = loadConfig();
  log("=== PVE Backup Validator started ===");
  log(`Host: ${config.pveHost}`);

  await checkRemotePrerequisites();

  const guestList = await getAllGuests();
  log(`Found ${guestList.length} guests across cluster`);

  const classified: ClassifiedGuest[] = [];

  for (const g of guestList) {
    const result = await classifyGuest(g.node, g.vmid, g.type);
    if (!result) {
      log(`WARN: Could not read config for ${g.type} ${g.vmid} on ${g.node}`);
      continue;
    }
    classified.push(result);
  }

  log("");
  log(summarizeJobs(classified));

  const jobsCfg = generateJobsCfg(classified);
  const JOBS_FILE = "/etc/pve/jobs.cfg";
  await pveWriteFile(JOBS_FILE, jobsCfg);
  log(
    `\nWrote ${JOBS_FILE} with ${classified.filter((g) => g.mode !== "skip").length} guests`
  );

  await pveExecSafe("pvescheduler restart 2>/dev/null");
  log("Scheduler restarted");

  const snapshotCount = classified.filter((g) => g.mode === "snapshot").length;
  const stopCount = classified.filter((g) => g.mode === "stop").length;
  log(
    `\nSummary: ${classified.length} guests classified (${snapshotCount} snapshot, ${stopCount} stop)`
  );
  log("=== Done ===");
}

if (import.meta.main) {
  main().catch((err) => {
    log(`ERROR: ${err.message}`);
    process.exit(1);
  });
}
