import { pveExecSafe } from "./ssh.js";
import { loadConfig } from "./config.js";
import type { BackupMode, ClassifiedGuest } from "./schemas.js";

function extractStorageName(ref: string): string {
  return ref.split(":")[0];
}

function resolveBackupMode(storageName: string): BackupMode {
  const config = loadConfig();
  return config.snapshotStorage.includes(storageName) ? "snapshot" : "stop";
}

interface PveshConfig {
  hostname?: string;
  name?: string;
  rootfs?: string;
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

  if (type === "ct") {
    const rootfs = config.rootfs || "";
    const rootfsStorage = extractStorageName(rootfs);
    const mode = resolveBackupMode(rootfsStorage);

    return {
      vmid,
      node,
      hostname,
      type: "ct",
      mode,
      storageType: rootfsStorage,
      reason: `rootfs on ${rootfsStorage}`,
    };
  }

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
    reason: `disk on ${storageName}`,
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
    const pveshConfig = JSON.parse(stdout) as PveshConfig;
    return classifyFromJson(pveshConfig, vmid, node, type);
  } catch {
    return null;
  }
}
