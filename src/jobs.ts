import type { ClassifiedGuest } from "./schemas.js";
import { loadConfig } from "./config.js";

interface JobDefinition {
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

function generateJobId(): string {
  const hex = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  return `backup-validator-${hex}`;
}

function buildJobs(guests: ClassifiedGuest[]): JobDefinition[] {
  const config = loadConfig();
  const snapshotGuests = guests.filter((g) => g.mode === "snapshot");
  const stopGuests = guests.filter((g) => g.mode === "stop");

  const jobs: JobDefinition[] = [];

  if (snapshotGuests.length > 0) {
    jobs.push({
      id: generateJobId(),
      comment: "BACKUP-SNAPSHOT (auto-generated)",
      schedule: config.schedule.snapshot,
      mode: "snapshot",
      vmids: snapshotGuests.map((g) => g.vmid),
      storage: config.backupTarget,
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
      schedule: config.schedule.stop,
      mode: "stop",
      vmids: stopGuests.map((g) => g.vmid),
      storage: config.backupTarget,
      compress: "zstd",
      notesTemplate: "{{node}} {{vmid}} {{guestname}}",
      notificationMode: "notification-system",
      repeatMissed: true,
    });
  }

  return jobs;
}

function jobToConfig(job: JobDefinition): string {
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

export function generateJobsCfg(guests: ClassifiedGuest[]): string {
  const jobs = buildJobs(guests);
  return jobs.map(jobToConfig).join("\n\n") + "\n";
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
