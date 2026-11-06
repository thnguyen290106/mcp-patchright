// Patchright upgrade regression coverage.
//
// Patchright 1.60.1 fixed iframe execution-context handling, 1.60.2 fixed
// visibility checks, and Patchright 1.64 (Playwright 1.64) moved the aria refs
// returned by `ariaSnapshot({ mode: "ai" })` to the public `page.getByRef()`
// API. Keep these behaviors covered before accepting future dependency updates.

import { chromium } from "patchright";

const browser = await chromium.launch({ headless: true });
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failed++;
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(`
    <button id="visible">Visible</button>
    <button id="display-none" style="display:none">Hidden</button>
    <button id="zero-size" style="width:0;height:0;padding:0;border:0">Zero</button>
    <iframe id="child"></iframe>
  `);

  await page.locator("#child").evaluate((iframe) => {
    iframe.srcdoc = '<button id="inside" onclick="this.dataset.clicked=\'yes\'">Inside</button>';
  });

  const visible = page.locator("#visible");
  const displayNone = page.locator("#display-none");
  const zeroSize = page.locator("#zero-size");

  check("visible element is visible", await visible.isVisible());
  check("display:none element is hidden", !(await displayNone.isVisible()));
  check("zero-size element is hidden", !(await zeroSize.isVisible()));

  const frame = page.frameLocator("#child");
  const inside = frame.locator("#inside");
  await inside.click();
  check(
    "iframe locator click keeps execution context",
    (await inside.getAttribute("data-clicked")) === "yes",
  );

  // The MCP snapshot/find/click/fill tools round-trip these ai-mode refs, so
  // cover the public page.getByRef() path added in Patchright 1.64.
  const aiSnapshot = await page.ariaSnapshot({ mode: "ai", timeout: 5_000 });
  check("aria snapshot exposes ai-mode refs", /\[ref=e\d+\]/.test(aiSnapshot), aiSnapshot.slice(0, 160));
  const visibleRef = aiSnapshot
    .split("\n")
    .find((line) => line.includes('button "Visible"'))
    ?.match(/\[ref=(e\d+)\]/)?.[1];
  check("aria snapshot includes the visible button ref", !!visibleRef, aiSnapshot.slice(0, 300));
  if (visibleRef) {
    const byRef = page.getByRef(visibleRef);
    check("page.getByRef resolves an ai-mode ref", (await byRef.count()) === 1, `ref=${visibleRef}`);
    await byRef.click();
    check("page.getByRef locator is interactive", true);
  }

  const credential = await context.credentials.create("example.test");
  check("passkey create returns key material", !!credential.id && !!credential.privateKey);
  const listed = await context.credentials.get({ id: credential.id });
  check("passkey list finds credential", listed.length === 1 && listed[0].rpId === "example.test");
  await context.credentials.install();
  const passkeyPage = await context.newPage();
  await passkeyPage.route("https://example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>passkey</title>" }),
  );
  await passkeyPage.goto("https://example.test/");
  check(
    "passkey authenticator installs",
    await passkeyPage.evaluate(
      () => typeof navigator.credentials?.create === "function" && typeof navigator.credentials?.get === "function",
    ),
  );
  await context.credentials.delete(credential.id);
  check("passkey delete removes credential", (await context.credentials.get({ id: credential.id })).length === 0);

  if (failed) process.exitCode = 1;
  else console.log("\nAll Patchright compatibility checks passed");
} finally {
  await browser.close();
}
