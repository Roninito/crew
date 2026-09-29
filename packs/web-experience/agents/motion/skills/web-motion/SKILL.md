# Web-motion skill

How the motion agent adds scroll-driven motion and 3D backgrounds to a built page.
Three independent layers -- use the cheapest tier that serves the brief.

## Layer decision tree

| Tier | Layers | When |
| --- | --- | --- |
| `static` | 1. CSS only | Content pages. `:hover` states and `animation-timeline: scroll()` reveals only. |
| `motion` | 1 + 2. Lenis + GSAP ScrollTrigger | Storytelling pages: pinned sections, parallax, scrubbed timelines. No WebGL. |
| `immersive` | 1 + 2 + 3. Three.js background | Hero/landing pages where depth is the point. Heaviest: justify it in one line. |

CSS-first always: if an effect works with `animation-timeline` or a transition, do not
spend JS on it. GSAP only for scrubbing, pinning, and sequenced timelines.

## Library lines (pinned majors, exact versions resolved per task)

- Lenis `1.x` — smooth scroll + anchor handling, wired to GSAP's ticker.
- GSAP `3.x` — ScrollTrigger only; no other plugins unless the brief names them.
- Three.js `0.18x` — background scene only, never content.

`scaffold-page.sh` resolves exact versions at build time and writes them to
`motion/vendor-versions.txt`, which the agent quotes in its handoff note. Upgrading a
major line means updating this skill first, in a separate task -- never mid-task.

## Scaffold contract (what builder markup must provide)

The motion layer assumes these hooks and never restructures markup to invent them.
Missing hook = send back to `build` with `feedback` naming it.

- `#bg-canvas` mount point (empty div, first element in body) for tier `immersive`.
- `[data-reveal]` attributes on blocks that animate in.
- `[data-pin]` on sections that pin (tier `motion` and up).
- A `prefers-reduced-motion` CSS guard already in the stylesheet.

## Hard rules (non-negotiable, checked by scripts + human review)

1. `prefers-reduced-motion: reduce` disables ALL layers: kill Lenis, `ScrollTrigger.getAll().forEach(t => t.kill())`, stop the render loop, show the static poster frame.
2. Content is fully readable with JavaScript disabled (motion is enhancement-only).
3. The canvas is `position: fixed; inset: 0; z-index: -1; pointer-events: none` -- it can
   never intercept clicks or cover text.
4. Device pixel ratio capped at 2; the render loop pauses when the tab is hidden or the
   canvas is off-screen (IntersectionObserver).
5. Budgets (asserted by `perf-budget.py`): Lighthouse performance ≥ 90 on mobile,
   motion JS (lenis + gsap + three + glue) < 150KB gzipped, no long tasks over 50ms
   attributable to animation code.

## Wiring pattern

```js
// 1. Lenis + GSAP ticker glue
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
const lenis = new Lenis({ autoRaf: false });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

// 2. Reveals + pins from markup hooks (no per-element bespoke code)
gsap.utils.toArray('[data-reveal]').forEach((el) => {
  gsap.from(el, { y: 24, opacity: 0, duration: 0.6, ease: 'power2.out',
    scrollTrigger: { trigger: el, start: 'top 85%' } });
});

// 3. Background scene (tier immersive only): fog + particles + slow drift,
//    camera rig or uniform driven by ScrollTrigger progress 0..1.
```

## Verification (evidence, not eyeballing)

- `shot-compare.py --url <local> --out shots/<stage>/` -- desktop + mobile screenshots at
  top/middle/bottom scroll depths. Saved as review evidence, attached to the handoff.
- `perf-budget.py --url <local>` -- asserts the budgets above. A failure goes back with
  `feedback` quoting the metric, never forward to review.
