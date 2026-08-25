import { pveExecSafe } from "./ssh.js";
import { TAG_SNAPSHOT, TAG_STOP } from "./config.js";
import type { ClassifiedGuest, BackupMode } from "./schemas.js";

function getRemoveTag(mode: BackupMode): string | null {
  if (mode === "snapshot") return TAG_STOP;
  if (mode === "stop") return TAG_SNAPSHOT;
  return null;
}

function parseTags(raw: string): string[] {
  const tagLine = raw.split("\n").find((l) => l.startsWith("tags:"));
  if (!tagLine) return [];
  return tagLine
    .replace("tags:", "")
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
}

function buildNewTags(currentTags: string[], mode: BackupMode): string[] {
  const desired = mode === "snapshot" ? TAG_SNAPSHOT : TAG_STOP;
  const remove = getRemoveTag(mode);

  let tags = currentTags.filter((t) => t !== remove);
  if (desired && !tags.includes(desired)) {
    tags.push(desired);
  }
  return tags;
}

function formatTags(tags: string[]): string {
  return tags.join(";");
}

export interface TagUpdate {
  vmid: string;
  node: string;
  type: "ct" | "vm";
  oldTags: string[];
  newTags: string[];
  changed: boolean;
}

export async function updateTags(
  guest: ClassifiedGuest
): Promise<TagUpdate> {
  const confPath =
    guest.type === "ct"
      ? `/etc/pve/lxc/${guest.vmid}.conf`
      : `/etc/pve/qemu-server/${guest.vmid}.conf`;

  const { stdout } = await pveExecSafe(`cat ${confPath}`);
  const currentTags = parseTags(stdout);
  const newTags = buildNewTags(currentTags, guest.mode);
  const changed = formatTags(currentTags) !== formatTags(newTags);

  if (changed) {
    const newTagsStr = formatTags(newTags);
    await pveExecSafe(
      `sed -i 's/^tags:.*/tags: ${newTagsStr}/' ${confPath}`
    );
  }

  return {
    vmid: guest.vmid,
    node: guest.node,
    type: guest.type,
    oldTags: currentTags,
    newTags,
    changed,
  };
}
