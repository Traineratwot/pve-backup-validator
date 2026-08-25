import { pveExecSafe } from "./ssh.js";
import {
  STORAGE_MODE_MAP,
  TAG_SNAPSHOT,
  TAG_STOP,
} from "./config.js";
import type { BackupMode, ClassifiedGuest } from "./schemas.js";

function extractStorageName(ref: string): string {
  return ref.split(":")[0];
}

function getStorageType(storageName: string): string {
  if (storageName === "local-zfs") return "zfspool";
  if (storageName === "storage") return "dir";
  if (storageName === "NAS") return "nfs";
  if (storageName === "local") return "dir";
  return "unknown";
}

function resolveBackupMode(storageName: string): BackupMode {
  const mode = STORAGE_MODE_MAP[storageName];
  if (mode) return mode;
  return "stop";
}

interface PveshConfig {
  hostname?: string;
  name?: string;
  rootfs?: string;
  tags?: string;
  [key: string]: any;
}

function classifyFromJson(
  config: PveshConfig,
  vmid: string,
  node: string,
  type: "ct" | "vm"
): ClassifiedGuest {
  const hostname =
    (type === "ct" ? config.hostname : config.name) || vmid;
  const tags = config.tags
    ? config.tags.split(";").map((t: string) => t.trim()).filter(Boolean)
    : [];

  if (type === "ct") {
    const rootfs = config.rootfs || "";
    const rootfsStorage = extractStorageName(rootfs);

    const mountPoints: string[] = [];
    for (const key of Object.keys(config)) {
      if (key.match(/^mp\d+$/)) {
        const ref = (config[key] as string).split(",")[0];
        mountPoints.push(extractStorageName(ref));
      }
    }

    const rootfsMode = resolveBackupMode(rootfsStorage);
    let reason = `rootfs on ${rootfsStorage} (${getStorageType(rootfsStorage)})`;

    if (rootfsMode === "snapshot") {
      const nonZfsMps = mountPoints.filter((s) => !["local-zfs"].includes(s));
      if (nonZfsMps.length > 0) {
        reason += `; ${nonZfsMps.length} mp on non-ZFS (backup=0 needed)`;
      }
    }

    return { vmid, node, hostname, type: "ct", mode: rootfsMode, storageType: rootfsStorage, reason };
  }

  // VM
  const diskKeys = Object.keys(config).filter(
    (k) =>
      (k.startsWith("scsi") && k !== "scsihw") ||
      k.startsWith("ide") ||
      k.startsWith("sata") ||
      k.startsWith("virtio")
  );

  let storageName = "unknown";
  for (const dk of diskKeys) {
    const ref = (config[dk] as string).split(",")[0];
    const name = extractStorageName(ref);
    if (name && name !== "none" && name !== "cdrom") {
      storageName = name;
      break;
    }
  }

  const mode = resolveBackupMode(storageName);
  return {
    vmid,
    node,
    hostname,
    type: "vm",
    mode,
    storageType: storageName,
    reason: `disk on ${storageName} (${getStorageType(storageName)})`,
  };
}

export async function classifyGuest(
  node: string,
  vmid: string,
  type: "ct" | "vm"
): Promise<ClassifiedGuest | null> {
  const apiType = type === "ct" ? "lxc" : "qemu";
  const { ok, stdout } = await pveExecSafe(
    `pvesh get /nodes/${node}/${apiType}/${vmid}/config --output-format json 2>/dev/null`
  );
  if (!ok || !stdout) return null;

  try {
    const config = JSON.parse(stdout) as PveshConfig;
    return classifyFromJson(config, vmid, node, type);
  } catch {
    return null;
  }
}

export async function fixMpBackup(
  guest: ClassifiedGuest
): Promise<string[]> {
  if (guest.mode !== "snapshot" || guest.type !== "ct") return [];

  const { stdout } = await pveExecSafe(
    `cat /etc/pve/lxc/${guest.vmid}.conf`
  );
  if (!stdout) return [];

  const lines = stdout.split("\n");
  const changes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const mpMatch = lines[i].match(/^(mp\d+):\s*(.+)/);
    if (!mpMatch) continue;

    const mpName = mpMatch[1];
    const fullRef = mpMatch[2];
    const storageName = fullRef.split(",")[0].split(":")[0];

    if (["local-zfs"].includes(storageName)) continue;

    if (!fullRef.includes("backup=0")) {
      const commaIdx = lines[i].indexOf(",");
      if (commaIdx !== -1) {
        lines[i] =
          lines[i].slice(0, commaIdx) + ",backup=0" + lines[i].slice(commaIdx);
      } else {
        lines[i] = lines[i] + ",backup=0";
      }
      changes.push(`${mpName}: ${storageName} → backup=0`);
    }
  }

  if (changes.length > 0) {
    const { pveWriteFile } = await import("./ssh.js");
    await pveWriteFile(`/etc/pve/lxc/${guest.vmid}.conf`, lines.join("\n"));
  }

  return changes;
}

export function getBackupTag(mode: BackupMode): string | null {
  if (mode === "snapshot") return TAG_SNAPSHOT;
  if (mode === "stop") return TAG_STOP;
  return null;
}
