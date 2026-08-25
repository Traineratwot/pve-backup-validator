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
