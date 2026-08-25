import { readFileSync } from "fs";
import { join } from "path";

export interface Config {
  pveHost: string;
  snapshotStorage: string[];
  backupTarget: string;
  schedule: {
    snapshot: string;
    stop: string;
  };
}

const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    _config = JSON.parse(raw) as Config;
    return _config!;
  } catch {
    throw new Error(
      "config.json not found. Run `bun run install` to configure the project."
    );
  }
}
