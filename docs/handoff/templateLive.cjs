// Does a template's Studio come up, and can an edit be made and saved?
// node templateLive.cjs <template dir> <port> <tanstack|nextjs>
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const [dir, port, kind] = process.argv.slice(2);
const base = `http://localhost:${port}`;

function moduleFiles() {
  const text = fs.readFileSync(path.join(dir, "val.modules.ts"), "utf8");
  return [...text.matchAll(/import\("\.\/([^"]+)"\)/g)].map(
    (m) => `/${m[1]}.ts`,
  );
}

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

(async () => {
  const args =
    kind === "nextjs"
      ? ["exec", "next", "dev", "--turbopack", "-p", port]
      : ["exec", "vite", "dev", "--port", port];
  const server = spawn("pnpm", args, {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const result = { studio: false, field: null, saved: false, errors: [] };
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
    args: ["--no-sandbox"],
  });
  try {
    if (!(await waitFor(`${base}/`, 180_000))) throw new Error("no server");
    const before = await (await fetch(`${base}/api/val/patches`)).json();
    const beforeCount = (before.patches ?? []).length;
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    });
    page.on("pageerror", (e) => result.errors.push(e.message.slice(0, 200)));
    await page.goto(`${base}/val`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
    const studio = page.locator("#val-shadow-root");
    await studio.getByRole("button").first().waitFor({ timeout: 180_000 });
    result.studio = true;
    const targets = process.env.TARGET
      ? [process.env.TARGET]
      : moduleFiles().filter((file) => !file.includes("settings"));
    for (const file of targets) {
      await page.goto(`${base}/val/~${file}`, {
        waitUntil: "domcontentloaded",
      });
      const input = studio
        .locator('input[type="text"], textarea, [contenteditable="true"]')
        .first();
      const found = await input
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!found) {
        await page.screenshot({
          path: `${process.env.SHOT_DIR ?? "/tmp"}/${path.basename(dir)}-${path.basename(file)}.png`,
        });
        continue;
      }
      result.field = file;
      await input.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" (checked)");
      break;
    }
    if (result.field !== null) {
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        const now = await (await fetch(`${base}/api/val/patches`)).json();
        if ((now.patches ?? []).length > beforeCount) {
          result.saved = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    result.errors.push(String(error).slice(0, 300));
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  console.log(JSON.stringify(result));
  if (!result.saved) console.log(serverLog.slice(-1500));
  process.exit(result.saved ? 0 : 1);
})();
