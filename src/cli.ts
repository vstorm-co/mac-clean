#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createServer, TOKEN } from "./server.js";

function parseArgs(argv: string[]): { port: number; open: boolean } {
  let port = 4280;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-open") open = false;
    else if (arg === "--port") port = Number(argv[++i]) || port;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: mac-clean [--port <n>] [--no-open]");
      process.exit(0);
    }
  }
  return { port, open };
}

function main(): void {
  const { port, open } = parseArgs(process.argv.slice(2));
  const server = createServer();

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is in use. Try: mac-clean --port ${port + 1}`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/?token=${TOKEN}`;
    console.log("\n  mac-clean is running.");
    console.log(`  Open: ${url}\n`);
    if (open) execFile("open", [url], () => {});
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
