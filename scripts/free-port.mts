#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("usage: node scripts/free-port.mts <port>");
  process.exit(2);
}

function run(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    const stdout = (error as { stdout?: unknown } | null)?.stdout;
    return typeof stdout === "string" ? stdout : "";
  }
}

function listeners(): number[] {
  const pids = new Set<number>();
  if (process.platform === "win32") {
    for (const line of run("netstat", ["-ano", "-p", "tcp"]).split(/\r?\n/)) {
      const [, local, , state, pidColumn] = line.trim().split(/\s+/);
      if (state !== "LISTENING" || local === undefined || pidColumn === undefined) continue;
      if (!local.endsWith(`:${port}`)) continue;
      const pid = Number(pidColumn);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  } else {
    for (const token of run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split(/\s+/)) {
      const pid = Number(token);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  pids.delete(process.pid);
  return [...pids];
}

function kill(pid: number): void {
  if (process.platform === "win32") {
    run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
    }
  }
}

const found = listeners();
if (found.length === 0) process.exit(0);

console.log(`[free-port] port ${port} held by pid ${found.join(", ")} — stopping the leftover`);
for (const pid of found) kill(pid);

const deadline = Date.now() + 3000;
while (Date.now() < deadline && listeners().length > 0) {
  execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 200)"]);
}

const left = listeners();
if (left.length > 0) {
  console.error(`[free-port] port ${port} is still held by pid ${left.join(", ")}`);
  process.exit(1);
}
