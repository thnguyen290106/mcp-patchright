import type { Locator, Page } from "patchright";

// Human-like input helpers: real Shift keyDown/up for capitals & symbols,
// variable inter-keystroke dwell, and off-center clicks within an element's
// bounding box. These reduce the automation footprint that naive
// locator.click()/insertText patterns leave behind.

// Uniform integer in [min, max].
export function randomDwell(min = 20, max = 90): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

// US-keyboard symbols that are produced by holding Shift + a base key.
const SHIFT_SYMBOLS: Record<string, string> = {
  "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
  "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "-",
  "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'",
  "<": ",", ">": ".", "?": "/",
};

// The base key to press while Shift is held to emit `ch`, or undefined if the
// character does not require Shift on a standard US layout.
function shiftBaseKey(ch: string): string | undefined {
  if (ch >= "A" && ch <= "Z") return ch.toLowerCase();
  return SHIFT_SYMBOLS[ch];
}

const ASCII_PRINTABLE = /^[\x20-\x7e]$/;

export interface HumanTypeOptions {
  // Fixed dwell in ms. When set, overrides the random range (backward compat
  // with an explicit `delay`). When omitted, dwell varies in [minDelay,maxDelay].
  delay?: number;
  minDelay?: number;
  maxDelay?: number;
}

// Type text into the currently-focused element one character at a time,
// dispatching genuine keydown/keyup events. Capitals and shifted symbols are
// entered with an explicit Shift keyDown/up around the base key so the target
// sees the same event sequence a human keyboard produces.
export async function humanType(page: Page, textStr: string, opts: HumanTypeOptions = {}): Promise<void> {
  const kb = page.keyboard;
  const min = opts.minDelay ?? 20;
  const max = opts.maxDelay ?? 90;
  for (const ch of textStr) {
    if (ch === "\n") {
      await kb.press("Enter");
    } else if (ch === "\t") {
      await kb.press("Tab");
    } else {
      const base = shiftBaseKey(ch);
      if (base) {
        await kb.down("Shift");
        await kb.press(base);
        await kb.up("Shift");
      } else if (ASCII_PRINTABLE.test(ch)) {
        await kb.press(ch);
      } else {
        // Non-ASCII (emoji, accented, CJK): no single keyboard key maps to it,
        // so insert the text directly. Still fires input events on the target.
        await kb.insertText(ch);
      }
    }
    const dwell = opts.delay ?? randomDwell(min, max);
    if (dwell > 0) await page.waitForTimeout(dwell);
  }
}

// Fraction in [0,1] that lands off the dead center of an axis: at least 10% and
// at most 25% of the box dimension away from the midpoint, on a random side.
function offCenterFraction(): number {
  const sign = Math.random() < 0.5 ? -1 : 1;
  return 0.5 + sign * (0.1 + Math.random() * 0.15);
}

// Click inside an element's bounding box at a randomized, off-center point via
// raw mouse move + click, instead of locator.click() which always targets the
// geometric center. Falls back to locator.click() when no box is available.
export async function humanClick(page: Page, locator: Locator, opts: { timeout?: number } = {}): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: opts.timeout }).catch(() => undefined);
  const box = await locator.boundingBox({ timeout: opts.timeout }).catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) {
    await locator.click({ timeout: opts.timeout });
    return;
  }
  const x = box.x + box.width * offCenterFraction();
  const y = box.y + box.height * offCenterFraction();
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}
