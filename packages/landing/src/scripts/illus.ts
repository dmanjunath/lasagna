// Plays each home illustration once as it scrolls into view, then leaves it at
// its final frame. The markup already is that frame. Only this script hides the
// moving parts (.illus-armed), so if it never loads, or the visitor asked for
// reduced motion, the pictures just sit still.
//
// A picture marks its moving parts with data-fx (how each one enters) and
// data-step (when: steps play in order, parts within a step slightly
// staggered). A Noodle with a raised arm waves once everything has settled,
// and a Noodle with eyelids then blinks every few seconds.

// The mini animate drives the browser's own animations (WAAPI), which keeps the
// bundle a few KB instead of the full engine.
import { inView } from "motion";
import { animate } from "motion/mini";
import { HELLO_WAVE, INTRO_DELAY, WAVE_HALF } from "@lasagna/design";

const ease = [0.22, 1, 0.36, 1] as const;
const bounce = [0.34, 1.4, 0.64, 1] as const;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const move = (x: number, y: number, s = 1) => `translate(${x}px, ${y}px) scale(${s})`;

function count(el: Element, to: number, ms: number) {
  const t0 = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = `$${Math.round(to * (1 - (1 - p) ** 3)).toLocaleString("en-US")}`;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return wait(ms);
}

type Fx = (el: Element, delay: number) => Promise<unknown>;
const enter = (x: number, y: number, s = 1, e: typeof ease | typeof bounce = ease): Fx => (el, delay) =>
  Promise.resolve(animate(el, { opacity: [0, 1], transform: [move(x, y, s), "none"] }, { duration: 0.45, ease: e, delay }));

const fx: Record<string, Fx> = {
  fade: (el, delay) => Promise.resolve(animate(el, { opacity: [0, 1] }, { duration: 0.4, delay })),
  up: enter(0, 16),
  down: enter(0, -24),
  left: enter(-18, 0),
  right: enter(18, 0),
  pop: enter(0, 0, 0.6, bounce),
  drop: enter(0, -60, 1, bounce),
  // Up from behind the shape drawn after it, so no fade: the shape hides it.
  rise: (el, delay) =>
    Promise.resolve(animate(el, { opacity: [1, 1], transform: [move(0, 80), "none"] }, { duration: 0.55, ease: bounce, delay })),
  draw: (el, delay) => Promise.resolve(animate(el, { strokeDashoffset: [1, 0] }, { duration: 0.7, ease, delay })),
  grow: (el, delay) => Promise.resolve(animate(el, { transform: ["scaleY(0)", "scaleY(1)"] }, { duration: 0.7, ease, delay })),
  growx: (el, delay) => Promise.resolve(animate(el, { transform: ["scaleX(0)", "scaleX(1)"] }, { duration: 0.7, ease, delay })),
  tilt: (el, delay) => {
    const to = `rotate(${(el as HTMLElement).dataset.deg ?? 0}deg)`;
    return Promise.resolve(animate(el, { transform: ["rotate(0deg)", to] }, { duration: 0.8, ease: bounce, delay }));
  },
  count: (el, delay) => wait(delay * 1000).then(() => count(el, Number((el as HTMLElement).dataset.to ?? 0), 1100)),
};

// Turned about the shoulder (122, 70) in the artwork's own units, the same
// three waves the app plays.
const turn = (deg: number) => `translate(122px, 70px) rotate(${deg}deg) translate(-122px, -70px)`;
async function wave(svg: Element) {
  const arm = svg.querySelector(".il-arm");
  if (!arm) return;
  await wait(INTRO_DELAY);
  let from = 0;
  for (const to of HELLO_WAVE) {
    await animate(arm, { transform: [turn(from), turn(to)] }, { duration: WAVE_HALF / 1000, ease: "easeInOut" });
    from = to;
  }
}

async function play(svg: Element) {
  // A picture inside a card that waits its turn to come in waits with it.
  const card = svg.closest<HTMLElement>("[data-reveal]");
  const delay = card ? (parseFloat(getComputedStyle(card).transitionDelay) || 0) * 1000 : 0;
  if (delay) await wait(delay);
  const parts = Array.from(svg.querySelectorAll<HTMLElement>("[data-fx]"));
  const steps = [...new Set(parts.map((p) => Number(p.dataset.step ?? 0)))].sort((a, b) => a - b);
  for (const s of steps) {
    const group = parts.filter((p) => Number(p.dataset.step ?? 0) === s);
    await Promise.all(group.map((p, i) => (fx[p.dataset.fx!] ?? fx.fade)(p, i * 0.08)));
  }
  await wave(svg);
  svg.classList.add("il-blinking");
}

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (const svg of Array.from(document.querySelectorAll("[data-illus]"))) {
    svg.classList.add("illus-armed");
    const stop = inView(svg, () => {
      stop();
      play(svg);
    }, { amount: 0.4 });
  }
}
