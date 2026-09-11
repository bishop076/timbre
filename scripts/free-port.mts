#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("usage: node scripts/free-port.mts <port>");
  process.exit(2);
}
const windows = process.platform === "win32";

function run(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    const { stdout } = error as { stdout?: unknown };
    return typeof stdout === "string" ? stdout : "";
  }
}

function listeners(): number[] {
  const tokens = windows
    ? run("netstat", ["-ano", "-p", "tcp"])
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter(([, local, , state]) => state === "LISTENING" && local?.endsWith(`:${port}`))
        .map((columns) => columns[4])
    : run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split(/\s+/);
  const pids = new Set(tokens.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0));
  pids.delete(process.pid);
  return [...pids];
}

const found = listeners();
if (found.length === 0) process.exit(0);

console.log(`[free-port] port ${port} held by pid ${found.join(", ")} — stopping the leftover`);
for (const pid of found) {
  if (windows) {
    run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}

const deadline = Date.now() + 3000;
while (Date.now() < deadline && listeners().length > 0) {
  execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 200)"]);
}

const left = listeners();
if (left.length > 0) {
  console.error(`[free-port] port ${port} is still held by pid ${left.join(", ")}`);
  process.exit(1);
}
