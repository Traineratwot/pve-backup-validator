import { $ } from "bun";

const PVE_HOST = "192.168.50.10";
const SSH_OPTS = ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no"];

export async function sshExec(
  host: string,
  command: string
): Promise<string> {
  const result = await $`ssh ${SSH_OPTS} root@${host} ${command}`.text();
  return result.trim();
}

export async function sshExecSafe(
  host: string,
  command: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(
      ["ssh", ...SSH_OPTS, `root@${host}`, command],
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
  return sshExec(PVE_HOST, command);
}

export async function pveExecSafe(
  command: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return sshExecSafe(PVE_HOST, command);
}

export async function sshWriteFile(
  host: string,
  remotePath: string,
  content: string
): Promise<boolean> {
  const proc = Bun.spawn(
    ["ssh", ...SSH_OPTS, `root@${host}`, `cat > ${remotePath}`],
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
  return sshWriteFile(PVE_HOST, remotePath, content);
}

export { PVE_HOST };
