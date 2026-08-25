export const NODES = ["pve", "pve2"] as const;

export const STORAGE_MODE_MAP: Record<string, "snapshot" | "stop"> = {
  "local-zfs": "snapshot",
  storage: "stop",
  NAS: "stop",
};

export const BACKUP_TARGET = "PBS";

export const SCHEDULE = {
  snapshot: "3:00",
  stop: "6:30",
  nas: "7:00",
} as const;

export const TAG_SNAPSHOT = "backup-snapshot";
export const TAG_STOP = "backup-stop";

export const LOG_FILE = "/var/log/pve-backup-validator.log";
export const JOBS_FILE = "/etc/pve/jobs.cfg";
