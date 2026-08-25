import * as v from "valibot";

export const StorageRefSchema = v.pipe(
  v.string(),
  v.regex(/^[a-zA-Z0-9_-]+:.+/, "Invalid storage reference format")
);

export const MountPointSchema = v.object({
  storage: v.string(),
  path: v.string(),
  raw: v.string(),
});

export const ContainerConfigSchema = v.object({
  vmid: v.pipe(v.string(), v.regex(/^\d+$/)),
  hostname: v.optional(v.string()),
  node: v.string(),
  rootfs: v.pipe(v.string(), StorageRefSchema),
  mountPoints: v.array(MountPointSchema),
  tags: v.array(v.string()),
  status: v.union([v.literal("running"), v.literal("stopped")]),
});

export const VmConfigSchema = v.object({
  vmid: v.pipe(v.string(), v.regex(/^\d+$/)),
  name: v.optional(v.string()),
  node: v.string(),
  disks: v.array(v.string()),
  tags: v.array(v.string()),
  status: v.union([v.literal("running"), v.literal("stopped")]),
});

export type ContainerConfig = v.InferOutput<typeof ContainerConfigSchema>;
export type VmConfig = v.InferOutput<typeof VmConfigSchema>;
export type BackupMode = "snapshot" | "stop" | "skip";

export interface ClassifiedGuest {
  vmid: string;
  node: string;
  hostname: string;
  type: "ct" | "vm";
  mode: BackupMode;
  storageType: string;
  reason: string;
}
