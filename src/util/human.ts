import type { Locator, Page } from "patchright";

// Human-like input helpers for Patchright.
//
// Key findings that drive this implementation (measured against Patchright's
// stealth CDP keyboard, not vanilla Playwright):
//   * Holding Shift and pressing the *base* key (e.g. down("Shift")+press("1"))
//     does NOT produce the shifted glyph — Patchright ignores the separately
//     tracked modifier for text, so "!" comes out as "1" and "D" as "d".
//   * keyboard.press(actualChar, {delay}) DOES emit the correct glyph, but with
//     no Shift keydown at all (shiftKey:false), so a detector never sees a
//     modifier.
//   * The winning combination is a real Shift keyDown/keyUp *wrapped around*
//     press(actualChar): correct text AND a genuine Shift event with
//     shiftKey:true on the character's keydown.
// The press `delay` gives us per-key dwell; inter-key gaps are slept separately.

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sleep(page: Page, ms: number): Promise<void> {
  return ms > 0 ? page.waitForTimeout(ms) : Promise.resolve();
}

// ---------------------------------------------------------------------------
// Per-page pointer state: each click should start from where the cursor last
// ended, otherwise every move teleports in from a random point.
// ---------------------------------------------------------------------------
interface HumanState {
  pointer?: { x: number; y: number };
}
const states = new WeakMap<Page, HumanState>();

function getState(page: Page): HumanState {
  let s = states.get(page);
  if (!s) {
    s = {};
    states.set(page, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

// US-keyboard glyphs produced with Shift held.
const SHIFTED: Record<string, string> = {
  "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
  "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\",
  ":": ";", '"': "'", "<": ",", ">": ".", "?": "/",
};

const ASCII_PRINTABLE = /^[\x20-\x7e]$/;

function needsShift(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || ch in SHIFTED;
}

// Per-key dwell (keydown -> keyup) in ms.
function dwell(): number {
  return randInt(25, 100);
}

// Inter-key gap distribution: mostly moderate, occasional very fast bursts and
// long pauses. High variance is what separates a human from a fixed delay.
function interKeyGap(): number {
  const r = Math.random();
  if (r < 0.15) return randInt(20, 55); // quick burst
  if (r < 0.5) return randInt(180, 450); // deliberate pause
  return randInt(60, 170); // normal
}

async function typeChar(page: Page, ch: string): Promise<void> {
  if (ch === "\n") {
    await page.keyboard.press("Enter", { delay: dwell() });
    return;
  }
  if (ch === "\t") {
    await page.keyboard.press("Tab", { delay: dwell() });
    return;
  }
  if (!ASCII_PRINTABLE.test(ch)) {
    // Non-ASCII (emoji, accented, CJK): no physical key maps to it. Insert
    // directly — still fires input events on the focused element.
    await page.keyboard.insertText(ch);
    return;
  }
  const shift = needsShift(ch);
  if (shift) await page.keyboard.down("Shift");
  // press(actualChar) yields the correct glyph under Patchright; the wrapping
  // Shift down/up makes the modifier visible (shiftKey:true) to detectors.
  await page.keyboard.press(ch, { delay: dwell() });
  if (shift) await page.keyboard.up("Shift");
}

export interface HumanTypeResult {
  typed: string;
  verified: boolean;
}

// Type `textStr` into `locator` one character at a time with real per-key
// events, variable dwell, and varied inter-key gaps. When the target is an
// input/textarea and `verify` is not disabled, the resulting value is checked
// against the request and a mismatch throws — a wrong glyph is never reported
// as success, even if stealth checks would pass.
export async function humanType(
  page: Page,
  locator: Locator,
  textStr: string,
  opts: { verify?: boolean; timeout?: number } = {},
): Promise<HumanTypeResult> {
  await locator.focus({ timeout: opts.timeout });

  // Capture pre-existing value (only defined for input-like elements).
  let before: string | null = null;
  try {
    before = await locator.inputValue({ timeout: 1000 });
  } catch {
    before = null; // contenteditable / non-input: verification skipped
  }

  const chars = [...textStr];
  for (let i = 0; i < chars.length; i++) {
    await typeChar(page, chars[i]);
    if (i < chars.length - 1) await sleep(page, interKeyGap());
  }

  // Verify exact result for input-like elements with plain text (control chars
  // like Enter/Tab mutate the DOM in ways that defeat a literal comparison).
  const verifiable = opts.verify !== false && before !== null && !/[\n\t]/.test(textStr);
  let verified = false;
  if (verifiable) {
    const after = await locator.inputValue({ timeout: opts.timeout }).catch(() => null);
    if (after !== null) {
      const expected = before + textStr;
      if (after !== expected) {
        throw new Error(
          `Typing mismatch: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(after)}`,
        );
      }
      verified = true;
    }
  }

  return { typed: textStr, verified };
}

// ---------------------------------------------------------------------------
// Mouse
// ---------------------------------------------------------------------------

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function cubicBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

// Move the pointer to (tx, ty) along a dense cubic-bezier arc with float
// coordinates and micro-jitter. Starts from the page's last known pointer
// position so movement is continuous rather than teleporting.
export async function humanMoveTo(page: Page, tx: number, ty: number): Promise<void> {
  const state = getState(page);
  const start = state.pointer ?? { x: tx + rand(-60, 60), y: ty + rand(-60, 60) };

  const dx = tx - start.x;
  const dy = ty - start.y;
  const distance = Math.hypot(dx, dy);

  // Bow the path perpendicular to the travel direction for a natural arc.
  const nlen = distance || 1;
  const nx = -dy / nlen;
  const ny = dx / nlen;
  const bow = clamp(distance * 0.15, 4, 60) * (Math.random() < 0.5 ? -1 : 1);
  const cp1 = {
    x: start.x + dx * 0.3 + nx * bow * rand(0.4, 1),
    y: start.y + dy * 0.3 + ny * bow * rand(0.4, 1),
  };
  const cp2 = {
    x: start.x + dx * 0.7 + nx * bow * rand(0.4, 1),
    y: start.y + dy * 0.7 + ny * bow * rand(0.4, 1),
  };

  const steps = clamp(Math.ceil(distance / 3.5), 16, 120);
  let prevX = start.x;
  let prevY = start.y;
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const p = cubicBezier(start, cp1, cp2, { x: tx, y: ty }, t);
    const px = p.x + rand(-0.7, 0.7);
    const py = p.y + rand(-0.7, 0.7);
    if (Math.hypot(px - prevX, py - prevY) < 0.2) continue; // drop duplicates
    await page.mouse.move(px, py);
    prevX = px;
    prevY = py;
    await sleep(page, randInt(4, 14));
  }
  // Settle exactly on the (float) target and remember it.
  await page.mouse.move(tx, ty);
  state.pointer = { x: tx, y: ty };
}

// Click an off-center point inside the element's bounding box using a human
// mouse path and a real press-hold. Never uses the geometric center, never
// falls back to a plain locator.click() when a box is available.
export async function humanClick(page: Page, locator: Locator, opts: { timeout?: number } = {}): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: opts.timeout }).catch(() => undefined);
  const box = await locator.boundingBox({ timeout: opts.timeout }).catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) {
    await locator.click({ timeout: opts.timeout });
    const b = await locator.boundingBox().catch(() => null);
    if (b) getState(page).pointer = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    return;
  }
  const x = box.x + box.width * rand(0.35, 0.65);
  const y = box.y + box.height * rand(0.35, 0.65);
  await humanMoveTo(page, x, y);
  await sleep(page, randInt(25, 70));
  await page.mouse.down();
  await sleep(page, randInt(40, 110));
  await page.mouse.up();
}
