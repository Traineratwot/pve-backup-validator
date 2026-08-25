import { $ } from "bun";
import { writeFileSync } from "fs";
import { loadConfig } from "./config.js";

const SSH_OPTS = ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no"];

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

export async function localExec(
  command: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: e.message };
  }
}

export async function pveExec(command: string): Promise<string> {
  const config = loadConfig();
  if (config.mode === "local") {
    const { stdout } = await localExec(command);
    return stdout;
  }
  return sshExec(config.pveHost!, command);
}

export async function pveExecSafe(
  command: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const config = loadConfig();
  if (config.mode === "local") {
    return localExec(command);
  }
  return sshExecSafe(config.pveHost!, command);
}

export async function pveWriteFile(
  remotePath: string,
  content: string
): Promise<boolean> {
  const config = loadConfig();
  if (config.mode === "local") {
    try {
      writeFileSync(remotePath, content);
      return true;
    } catch {
      return false;
    }
  }
  const proc = Bun.spawn(
    [
      "ssh",
      ...SSH_OPTS,
      `root@${config.pveHost}`,
      `cat > ${remotePath}`,
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" }
  );
  proc.stdin.write(content);
  proc.stdin.end();
  const exitCode = await proc.exited;
  return exitCode === 0;
}
