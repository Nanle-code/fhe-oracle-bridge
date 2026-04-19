/**
 * Serves frontend/ on 0.0.0.0. If PORT (default 8765) is in use, tries the next ports.
 * Usage: npm run frontend
 *        PORT=9000 npm run frontend
 */

const net = require("net");
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const startPort = Number.parseInt(process.env.PORT || "8765", 10);
const base = Number.isFinite(startPort) && startPort > 0 ? startPort : 8765;

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "0.0.0.0", () => {
      s.once("close", () => resolve(true));
      s.close();
    });
  });
}

async function pickPort(from, maxAttempts = 40) {
  for (let p = from; p < from + maxAttempts; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`No free TCP port in range ${from}..${from + maxAttempts - 1}`);
}

(async () => {
  const port = await pickPort(base);
  if (port !== base) {
    console.log(`(Port ${base} was busy — using ${port}. Set PORT=${port} to pin it.)\n`);
  }
  console.log("");
  console.log("  Open in your browser (not 0.0.0.0):");
  console.log(`    http://127.0.0.1:${port}/`);
  console.log(`    http://localhost:${port}/`);
  console.log("");
  const child = spawn(
    "python3",
    ["-m", "http.server", String(port), "--bind", "0.0.0.0", "--directory", "frontend"],
    { stdio: "inherit", cwd: root }
  );
  child.on("error", (err) => {
    console.error(err);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code == null ? 1 : code));
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
