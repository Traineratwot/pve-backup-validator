import { pveExec, pveExecSafe, pveWriteFile } from "./ssh.js";
import { classifyGuest, fixMpBackup } from "./classify.js";
import { updateTags } from "./tags.js";
import { generateJobsCfg, summarizeJobs } from "./jobs.js";
import { JOBS_FILE } from "./config.js";
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
  log("=== PVE Backup Validator started ===");

  const guestList = await getAllGuests();
  log(`Found ${guestList.length} guests across cluster`);

  const classified: ClassifiedGuest[] = [];
  const tagUpdates: { vmid: string; changed: boolean }[] = [];
  const mpFixes: { vmid: string; fixes: string[] }[] = [];

  for (const g of guestList) {
    const result = await classifyGuest(g.node, g.vmid, g.type);
    if (!result) {
      log(`WARN: Could not read config for ${g.type} ${g.vmid} on ${g.node}`);
      continue;
    }
    classified.push(result);

    const tagUpdate = await updateTags(result);
    tagUpdates.push({ vmid: result.vmid, changed: tagUpdate.changed });
    if (tagUpdate.changed) {
      log(`  TAG ${result.vmid}: [${tagUpdate.oldTags.join(",")}] → [${tagUpdate.newTags.join(",")}]`);
    }

    const fixes = await fixMpBackup(result);
    if (fixes.length > 0) {
      mpFixes.push({ vmid: result.vmid, fixes });
      log(`  MP FIX ${result.vmid}: ${fixes.join("; ")}`);
    }
  }

  log("");
  log(summarizeJobs(classified));

  const jobsCfg = generateJobsCfg(classified);
  await pveWriteFile(JOBS_FILE, jobsCfg);
  log(`\nWrote ${JOBS_FILE} with ${classified.filter((g) => g.mode !== "skip").length} guests`);

  await pveExec("pvescheduler restart 2>/dev/null");
  log("Scheduler restarted");

  const changedTags = tagUpdates.filter((t) => t.changed).length;
  const changedMps = mpFixes.filter((m) => m.fixes.length > 0).length;
  log(`\nSummary: ${classified.length} guests classified, ${changedTags} tags updated, ${changedMps} mount points fixed`);
  log("=== Done ===");
}

// CLI entry point
if (import.meta.main) {
  main().catch((err) => {
    log(`ERROR: ${err.message}`);
    process.exit(1);
  });
}
