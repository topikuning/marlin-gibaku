import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage();
await p.goto("http://localhost:3000/masuk");
await p.getByLabel("Username atau email").fill("admin");
await p.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
await p.getByRole("button", { name: "Masuk" }).click();
await p.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 30000 });
for (const rute of ["/ai", "/ai/ask", "/ai/reports", "/ai/actions", "/ai/history", "/ai/paparan"]) {
  const r = await p.goto("http://localhost:3000" + rute, { waitUntil: "domcontentloaded" });
  console.log(rute, "→", r?.status());
}
await b.close();
