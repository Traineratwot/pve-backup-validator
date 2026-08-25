import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ClassifiedGuest } from "../src/schemas.js";
import type { Config } from "../src/config.js";

// --- Mock config ---

const TEST_CONFIG: Config = {
  mode: "local",
  localNode: "pve",
  snapshotStorage: ["local-zfs", "fast-zfs"],
  backupTarget: "PBS",
  schedule: {
    snapshot: "0 3 * * *",
    stop: "30 6 * * *",
  },
};

mock.module("../src/config.js", () => ({
  loadConfig: () => TEST_CONFIG,
}));

// --- Now import after mocking ---

import {
  extractStorageName,
  resolveBackupMode,
  classifyFromJson,
} from "../src/classify.js";
import {
  generateJobId,
  buildJobs,
  jobToConfig,
  generateJobsCfg,
  summarizeJobs,
} from "../src/jobs.js";
import { timeToCron, hasTool } from "../src/install.js";
import { localExec } from "../src/ssh.js";

// --- Helpers ---

function makeGuest(overrides: Partial<ClassifiedGuest> = {}): ClassifiedGuest {
  return {
    vmid: "100",
    node: "pve",
    hostname: "test-ct",
    type: "ct",
    mode: "snapshot",
    storageType: "local-zfs",
    reason: "rootfs on local-zfs",
    ...overrides,
  };
}

// --- Tests ---

describe("extractStorageName", () => {
  it("extracts storage from standard ref", () => {
    expect(extractStorageName("local-zfs:subvol-100-disk-0")).toBe("local-zfs");
  });

  it("extracts storage without subvol", () => {
    expect(extractStorageName("PBS:backup")).toBe("PBS");
  });

  it("returns ref as-is if no colon", () => {
    expect(extractStorageName("local-zfs")).toBe("local-zfs");
  });

  it("handles empty string", () => {
    expect(extractStorageName("")).toBe("");
  });
});

describe("resolveBackupMode", () => {
  it("returns snapshot for known storage", () => {
    expect(resolveBackupMode("local-zfs", ["local-zfs"])).toBe("snapshot");
  });

  it("returns stop for unknown storage", () => {
    expect(resolveBackupMode("local-lvm", ["local-zfs"])).toBe("stop");
  });

  it("handles multiple snapshot storages", () => {
    expect(resolveBackupMode("fast-zfs", ["local-zfs", "fast-zfs"])).toBe(
      "snapshot"
    );
  });

  it("returns stop for empty snapshot list", () => {
    expect(resolveBackupMode("local-zfs", [])).toBe("stop");
  });
});

describe("classifyFromJson", () => {
  const snapshotStorage = ["local-zfs", "fast-zfs"];

  describe("CT classification", () => {
    it("classifies CT with ZFS rootfs as snapshot", () => {
      const result = classifyFromJson(
        { hostname: "web", rootfs: "local-zfs:subvol-100-disk-0" },
        "100",
        "pve",
        "ct",
        snapshotStorage
      );
      expect(result.mode).toBe("snapshot");
      expect(result.storageType).toBe("local-zfs");
      expect(result.hostname).toBe("web");
    });

    it("classifies CT with dir rootfs as stop", () => {
      const result = classifyFromJson(
        { hostname: "app", rootfs: "local-lvm:subvol-101-disk-0" },
        "101",
        "pve",
        "ct",
        snapshotStorage
      );
      expect(result.mode).toBe("stop");
      expect(result.storageType).toBe("local-lvm");
    });

    it("falls back to vmid when hostname missing", () => {
      const result = classifyFromJson(
        { rootfs: "local-zfs:subvol-100-disk-0" },
        "100",
        "pve",
        "ct",
        snapshotStorage
      );
      expect(result.hostname).toBe("100");
    });

    it("handles empty rootfs", () => {
      const result = classifyFromJson({}, "100", "pve", "ct", snapshotStorage);
      expect(result.mode).toBe("stop");
      expect(result.storageType).toBe("");
    });
  });

  describe("VM classification", () => {
    it("classifies VM with ZFS disk as snapshot", () => {
      const result = classifyFromJson(
        { name: "db-vm", scsi0: "local-zfs:vm-200-disk-0" },
        "200",
        "pve",
        "vm",
        snapshotStorage
      );
      expect(result.mode).toBe("snapshot");
      expect(result.storageType).toBe("local-zfs");
      expect(result.hostname).toBe("db-vm");
    });

    it("classifies VM with dir disk as stop", () => {
      const result = classifyFromJson(
        { name: "app-vm", scsi0: "local-lvm:vm-201-disk-0" },
        "201",
        "pve",
        "vm",
        snapshotStorage
      );
      expect(result.mode).toBe("stop");
      expect(result.storageType).toBe("local-lvm");
    });

    it("skips scsihw when scanning disk keys", () => {
      const result = classifyFromJson(
        {
          name: "vm",
          scsihw: "virtio-scsi-pci",
          scsi0: "local-zfs:vm-200-disk-0",
        },
        "200",
        "pve",
        "vm",
        snapshotStorage
      );
      expect(result.storageType).toBe("local-zfs");
    });

    it("skips ide-scsi cdrom disks", () => {
      const result = classifyFromJson(
        {
          name: "vm",
          ide0: "none,media=cdrom",
          scsi0: "local-zfs:vm-200-disk-0",
        },
        "200",
        "pve",
        "vm",
        snapshotStorage
      );
      expect(result.storageType).toBe("local-zfs");
    });

    it("tries multiple disk keys", () => {
      const result = classifyFromJson(
        {
          name: "vm",
          ide0: "none,media=cdrom",
          sata0: "local-lvm:vm-200-disk-0",
          scsi0: "local-zfs:vm-200-disk-1",
        },
        "200",
        "pve",
        "vm",
        snapshotStorage
      );
      // sata0 is first non-cdrom disk
      expect(result.storageType).toBe("local-lvm");
    });

    it("falls back to vmid when name missing", () => {
      const result = classifyFromJson(
        { scsi0: "local-zfs:vm-200-disk-0" },
        "200",
        "pve",
        "vm",
        snapshotStorage
      );
      expect(result.hostname).toBe("200");
    });

    it("returns unknown when no disks found", () => {
      const result = classifyFromJson(
        { name: "vm" },
        "200",
        "pve",
        "vm",
        snapshotStorage
      );
      expect(result.storageType).toBe("unknown");
      expect(result.mode).toBe("stop");
    });
  });
});

describe("generateJobId", () => {
  it("returns correct format", () => {
    const id = generateJobId();
    expect(id).toMatch(/^backup-validator-[0-9a-f]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateJobId()));
    expect(ids.size).toBe(50);
  });
});

describe("buildJobs", () => {
  const schedule = { snapshot: "0 3 * * *", stop: "30 6 * * *" };

  it("creates snapshot job for snapshot guests", () => {
    const guests = [makeGuest({ mode: "snapshot" })];
    const jobs = buildJobs(guests, schedule, "PBS");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].mode).toBe("snapshot");
    expect(jobs[0].vmids).toEqual(["100"]);
    expect(jobs[0].storage).toBe("PBS");
    expect(jobs[0].schedule).toBe("0 3 * * *");
  });

  it("creates stop job for stop guests", () => {
    const guests = [makeGuest({ mode: "stop" })];
    const jobs = buildJobs(guests, schedule, "PBS");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].mode).toBe("stop");
    expect(jobs[0].schedule).toBe("30 6 * * *");
  });

  it("creates both jobs when mixed", () => {
    const guests = [
      makeGuest({ vmid: "100", mode: "snapshot" }),
      makeGuest({ vmid: "200", mode: "stop" }),
    ];
    const jobs = buildJobs(guests, schedule, "PBS");
    expect(jobs).toHaveLength(2);
    expect(jobs[0].mode).toBe("snapshot");
    expect(jobs[1].mode).toBe("stop");
  });

  it("returns empty when no guests", () => {
    const jobs = buildJobs([], schedule, "PBS");
    expect(jobs).toHaveLength(0);
  });

  it("collects all vmids for same mode", () => {
    const guests = [
      makeGuest({ vmid: "100", mode: "snapshot" }),
      makeGuest({ vmid: "200", mode: "snapshot" }),
      makeGuest({ vmid: "300", mode: "snapshot" }),
    ];
    const jobs = buildJobs(guests, schedule, "PBS");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].vmids).toEqual(["100", "200", "300"]);
  });

  it("uses custom backup target", () => {
    const guests = [makeGuest({ mode: "snapshot" })];
    const jobs = buildJobs(guests, schedule, "NAS");
    expect(jobs[0].storage).toBe("NAS");
  });
});

describe("jobToConfig", () => {
  it("generates valid Proxmox config format", () => {
    const job = buildJobs(
      [makeGuest({ mode: "snapshot" })],
      { snapshot: "0 3 * * *", stop: "30 6 * * *" },
      "PBS"
    )[0];
    const cfg = jobToConfig(job);

    expect(cfg).toContain(`vzdump: ${job.id}`);
    expect(cfg).toContain("\tschedule 0 3 * * *");
    expect(cfg).toContain("\tmode snapshot");
    expect(cfg).toContain("\tstorage PBS");
    expect(cfg).toContain("\tvmid 100");
    expect(cfg).toContain("\tenabled 1");
    expect(cfg).toContain("\tcompress zstd");
    expect(cfg).toContain("\trepeat-missed 1");
  });

  it("joins multiple vmids with comma", () => {
    const job = buildJobs(
      [
        makeGuest({ vmid: "100", mode: "stop" }),
        makeGuest({ vmid: "200", mode: "stop" }),
      ],
      { snapshot: "0 3 * * *", stop: "30 6 * * *" },
      "PBS"
    )[0];
    const cfg = jobToConfig(job);
    expect(cfg).toContain("\tvmid 100,200");
  });
});

describe("generateJobsCfg", () => {
  it("generates complete config with snapshot and stop sections", () => {
    const guests = [
      makeGuest({ vmid: "100", mode: "snapshot" }),
      makeGuest({ vmid: "200", mode: "stop" }),
    ];
    const cfg = generateJobsCfg(guests);

    expect(cfg).toContain("BACKUP-SNAPSHOT");
    expect(cfg).toContain("BACKUP-STOP");
    expect(cfg).toContain("mode snapshot");
    expect(cfg).toContain("mode stop");
  });

  it("generates only snapshot section when all snapshot", () => {
    const guests = [makeGuest({ mode: "snapshot" })];
    const cfg = generateJobsCfg(guests);
    expect(cfg).toContain("BACKUP-SNAPSHOT");
    expect(cfg).not.toContain("BACKUP-STOP");
  });

  it("generates only stop section when all stop", () => {
    const guests = [makeGuest({ mode: "stop" })];
    const cfg = generateJobsCfg(guests);
    expect(cfg).not.toContain("BACKUP-SNAPSHOT");
    expect(cfg).toContain("BACKUP-STOP");
  });

  it("returns empty for no guests", () => {
    const cfg = generateJobsCfg([]);
    expect(cfg.trim()).toBe("");
  });
});

describe("summarizeJobs", () => {
  it("groups guests by mode", () => {
    const guests = [
      makeGuest({ vmid: "100", hostname: "web", mode: "snapshot" }),
      makeGuest({ vmid: "200", hostname: "db", mode: "stop" }),
    ];
    const summary = summarizeJobs(guests);
    expect(summary).toContain("Snapshot backup (1 guests):");
    expect(summary).toContain("Stop backup (1 guests):");
    expect(summary).toContain("100");
    expect(summary).toContain("web");
    expect(summary).toContain("200");
    expect(summary).toContain("db");
  });

  it("shows zero count when no guests in category", () => {
    const guests = [makeGuest({ mode: "snapshot" })];
    const summary = summarizeJobs(guests);
    expect(summary).toContain("Snapshot backup (1 guests):");
    expect(summary).toContain("Stop backup (0 guests):");
  });
});

describe("timeToCron", () => {
  it("converts 03:00 to cron", () => {
    expect(timeToCron("03:00")).toBe("0 3 * * *");
  });

  it("converts 06:30 to cron", () => {
    expect(timeToCron("06:30")).toBe("30 6 * * *");
  });

  it("converts 23:59 to cron", () => {
    expect(timeToCron("23:59")).toBe("59 23 * * *");
  });

  it("converts 0:00 to cron", () => {
    expect(timeToCron("0:00")).toBe("0 0 * * *");
  });
});

describe("hasTool", () => {
  it("returns true for existing tool", () => {
    expect(hasTool("sh")).toBe(true);
  });

  it("returns false for missing tool", () => {
    expect(hasTool("nonexistent-tool-xyz")).toBe(false);
  });
});

describe("localExec", () => {
  it("executes command and returns stdout", async () => {
    const result = await localExec("echo hello");
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("hello");
  });

  it("returns stderr on failure", async () => {
    const result = await localExec("cat /nonexistent-file-xyz");
    expect(result.ok).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
