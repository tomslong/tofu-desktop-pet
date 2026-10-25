/* Launch Electron with a clean child environment.
 *
 * Some terminals (including the one this project was built in) export
 * ELECTRON_RUN_AS_NODE=1. That turns electron.exe into a plain Node runtime,
 * which makes require("electron") return a path instead of the app API. Strip
 * those inherited debugging variables before spawning the real app.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const electron = require("electron");
const projectRoot = path.join(__dirname, "..");
const passthrough = process.argv.slice(2);
const flags = passthrough.filter((arg) => arg.startsWith("--"));
const appArgs = passthrough.filter((arg) => !arg.startsWith("--"));

const nestedSandbox = Boolean(
  process.env.DSH_SHELL || process.env.DSH_SESSION_ID || process.env.ELECTRON_RUN_AS_NODE,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CHROME_CRASHPAD_PIPE_NAME;

// A DSH/agent terminal is itself a constrained Electron process. Chromium's
// sandbox cannot initialize inside it; the app only loads local, trusted files.
if (nestedSandbox && !flags.includes("--no-sandbox")) flags.push("--no-sandbox");

const args = [...flags, ...appArgs, projectRoot];
const child = spawn(electron, args, { stdio: "inherit", env, windowsHide: false });

child.on("error", (error) => {
  console.error("[tofu] failed to launch Electron:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
