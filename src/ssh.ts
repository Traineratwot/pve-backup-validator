import { $ } from "bun";
import { loadConfig } from "./config.js";

const SSH_OPTS = ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no"];

function host(): string {
  return loadConfig().pveHost;
}

export async function sshExec(
  targetHost: string,
  command: string
): Promise<string> {
  const result = await $`ssh ${SSH_OPTS} root@${targetHost} ${command}`.text();
  return result.trim();
}

export async function sshExecSafe(
  targetHost: string,
  command: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(
      ["ssh", ...SSH_OPTS, `root@${targetHost}`, command],
      { stdout: "pipe", stderr: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: e.message };
  }
}

export async function pveExec(command: string): Promise<string> {
  return sshExec(host(), command);
}

export async function pveExecSafe(
  command: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return sshExecSafe(host(), command);
}

export async function sshWriteFile(
  targetHost: string,
  remotePath: string,
  content: string
): Promise<boolean> {
  const proc = Bun.spawn(
    ["ssh", ...SSH_OPTS, `root@${targetHost}`, `cat > ${remotePath}`],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" }
  );
  proc.stdin.write(content);
  proc.stdin.end();
  const exitCode = await proc.exited;
  return exitCode === 0;
}

export async function pveWriteFile(
  remotePath: string,
  content: string
): Promise<boolean> {
  return sshWriteFile(host(), remotePath, content);
}
