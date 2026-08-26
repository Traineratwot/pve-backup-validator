import type { ClassifiedGuest } from "./schemas.js";
import { loadConfig } from "./config.js";
import { pveExecSafe } from "./ssh.js";

export interface JobDefinition {
  id: string;
  comment: string;
  schedule: string;
  mode: string;
  vmids: string[];
  storage: string;
  compress: string;
  notesTemplate: string;
  notificationMode: string;
  repeatMissed: boolean;
}

export function generateJobId(): string {
  const hex = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  return `backup-validator-${hex}`;
}

export function buildJobs(
  guests: ClassifiedGuest[],
  schedule: { snapshot: string; stop: string },
  backupTarget: string
): JobDefinition[] {
  const snapshotGuests = guests.filter((g) => g.mode === "snapshot");
  const stopGuests = guests.filter((g) => g.mode === "stop");

  const jobs: JobDefinition[] = [];

  if (snapshotGuests.length > 0) {
    jobs.push({
      id: generateJobId(),
      comment: "BACKUP-SNAPSHOT (auto-generated)",
      schedule: schedule.snapshot,
      mode: "snapshot",
      vmids: snapshotGuests.map((g) => g.vmid),
      storage: backupTarget,
      compress: "zstd",
      notesTemplate: "{{node}} {{vmid}} {{guestname}}",
      notificationMode: "notification-system",
      repeatMissed: true,
    });
  }

  if (stopGuests.length > 0) {
    jobs.push({
      id: generateJobId(),
      comment: "BACKUP-STOP (auto-generated)",
      schedule: schedule.stop,
      mode: "stop",
      vmids: stopGuests.map((g) => g.vmid),
      storage: backupTarget,
      compress: "zstd",
      notesTemplate: "{{node}} {{vmid}} {{guestname}}",
      notificationMode: "notification-system",
      repeatMissed: true,
    });
  }

  return jobs;
}

export function jobToConfig(job: JobDefinition): string {
  const lines = [
    `vzdump: ${job.id}`,
    `\tcomment ${job.comment}`,
    `\tschedule ${job.schedule}`,
    `\tcompress ${job.compress}`,
    `\tenabled 1`,
    `\tmode ${job.mode}`,
    `\tnotes-template ${job.notesTemplate}`,
    `\tnotification-mode ${job.notificationMode}`,
    `\trepeat-missed ${job.repeatMissed ? 1 : 0}`,
    `\tstorage ${job.storage}`,
    `\tvmid ${job.vmids.join(",")}`,
  ];

  return lines.join("\n");
}

export function parseExistingJobsCfg(cfgContent: string): {
  autoJobs: string[];
  manualJobs: string[];
} {
  const autoJobs: string[] = [];
  const manualJobs: string[] = [];

  const blocks = cfgContent.split(/(?=^vzdump: )/m).filter((b) => b.trim());

  for (const block of blocks) {
    const isAuto =
      block.includes("BACKUP-SNAPSHOT (auto-generated)") ||
      block.includes("BACKUP-STOP (auto-generated)");
    if (isAuto) {
      autoJobs.push(block);
    } else {
      manualJobs.push(block);
    }
  }

  return { autoJobs, manualJobs };
}

export async function readExistingJobsCfg(
  jobsFile: string
): Promise<{ autoJobs: string[]; manualJobs: string[] }> {
  const { ok, stdout } = await pveExecSafe(`cat "${jobsFile}" 2>/dev/null`);
  if (!ok || !stdout) {
    return { autoJobs: [], manualJobs: [] };
  }
  return parseExistingJobsCfg(stdout);
}

export function generateJobsCfg(
  guests: ClassifiedGuest[],
  existingManualJobs: string[]
): string {
  const config = loadConfig();
  const jobs = buildJobs(guests, config.schedule, config.backupTarget);
  const autoConfig = jobs.map(jobToConfig).join("\n\n");

  const parts = [...existingManualJobs, autoConfig].filter((p) => p.trim());
  return parts.join("\n\n") + "\n";
}

export function summarizeJobs(guests: ClassifiedGuest[]): string {
  const snapshot = guests.filter((g) => g.mode === "snapshot");
  const stop = guests.filter((g) => g.mode === "stop");

  const lines = [
    `Snapshot backup (${snapshot.length} guests):`,
    ...snapshot.map(
      (g) =>
        `  ${g.vmid.padEnd(5)} ${g.hostname.padEnd(25)} [${g.node}] ${g.reason}`
    ),
    "",
    `Stop backup (${stop.length} guests):`,
    ...stop.map(
      (g) =>
        `  ${g.vmid.padEnd(5)} ${g.hostname.padEnd(25)} [${g.node}] ${g.reason}`
    ),
  ];

  return lines.join("\n");
}
