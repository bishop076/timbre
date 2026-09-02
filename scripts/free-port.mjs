#!/usr/bin/env node
/**
 * Frees a TCP port before a dev server binds it. `node scripts/free-port.mjs 8787`
 *
 * **Why this exists — `docs/BUGS.md` B-7.** `pnpm dev:ytmusic` runs uvicorn with
 * `--reload`, which is a reloader parent plus a worker child. Killing the parent
 * (Ctrl-C in a terminal that closes too fast, a task manager, an editor's terminal
 * being disposed) orphans the child, and the orphan keeps the port bound and keeps
 * serving the module it loaded. The symptom is 500s with nothing in the log, or
 * code changes that have no effect, persisting across "restarts" — because the
 * restart lost the bind race to a process nobody can see in the terminal.
 *
 * So the dev script asks for the port first. Anything listening on it is a leftover
 * of a previous run of the same script — nothing else in this project uses it — and
 * is killed with its process tree, so the reloader and its worker go together.
 *
 * Deliberately bounded to *listening* sockets: a client connection to the port from
 * a browser or curl is not a leftover server.
 */

import { execFileSync } from "node:child_process";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("usage: node scripts/free-port.mjs <port>");
  process.exit(2);
}

/** Runs a command and returns stdout, or "" when the tool is missing or finds nothing. */
function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    // `lsof` and `findstr` exit non-zero for "no match", which is the common case.
    return typeof error?.stdout === "string" ? error.stdout : "";
  }
}

/** PIDs of processes with a LISTENING socket on the port, on this platform. */
function listeners() {
  const pids = new Set();
  if (process.platform === "win32") {
    // PROTO  LOCAL              FOREIGN   STATE      PID
    // TCP    127.0.0.1:8787     0.0.0.0:0 LISTENING  12345
    for (const line of run("netstat", ["-ano", "-p", "tcp"]).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5 || cols[3] !== "LISTENING") continue;
      if (!cols[1].endsWith(`:${port}`)) continue;
      const pid = Number(cols[4]);
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

function kill(pid) {
  if (process.platform === "win32") {
    // /T takes the tree, so a reloader parent and its worker go together rather than
    // the worker being re-orphaned by the very script meant to clear it.
    run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone between the listing and now.
    }
  }
}

const found = listeners();
if (found.length === 0) process.exit(0);

console.log(`[free-port] port ${port} held by pid ${found.join(", ")} — stopping the leftover`);
for (const pid of found) kill(pid);

// Give the OS a moment to release the socket; uvicorn would otherwise lose the race.
const deadline = Date.now() + 3000;
while (Date.now() < deadline && listeners().length > 0) {
  execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 200)"]);
}

const left = listeners();
if (left.length > 0) {
  console.error(`[free-port] port ${port} is still held by pid ${left.join(", ")}`);
  process.exit(1);
}
