#!/usr/bin/env bash
# Scaffold a motion-ready page shell into a work tree: markup hooks, Lenis+GSAP
# wiring, reduced-motion guard, and pinned library versions.
# Usage: scaffold-page.sh <dest-dir> <tier: static|motion|immersive>
set -euo pipefail
DEST="${1:?Usage: scaffold-page.sh <dest-dir> <tier>}"
TIER="${2:?Usage: scaffold-page.sh <dest-dir> <tier>}"
case "$TIER" in static|motion|immersive) ;; *) echo "tier must be static|motion|immersive" >&2; exit 1;; esac
mkdir -p "$DEST"

LENIS="$(npm view lenis version 2>/dev/null || echo 1-latest)"
GSAP="$(npm view gsap version 2>/dev/null || echo 3-latest)"
THREE="$(npm view three version 2>/dev/null || echo 0.18-latest)"
printf 'lenis %s\ngsap %s\nthree %s\n' "$LENIS" "$GSAP" "$THREE" > "$DEST/vendor-versions.txt"

CANVAS=""
if [ "$TIER" = "immersive" ]; then CANVAS='<div id="bg-canvas" aria-hidden="true"></div>'; fi
MOTION_JS=""
if [ "$TIER" != "static" ]; then MOTION_JS='<script type="module" src="motion.js"></script>'; fi

cat > "$DEST/index.html" << HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
$CANVAS
<main>
<section data-reveal>
<h1>{{HEADING}}</h1>
<p>{{LEDE}}</p>
</section>
</main>
$MOTION_JS
</body>
</html>
HTML

cat > "$DEST/styles.css" << CSS
main { max-width: 68ch; margin: 0 auto; padding: 2rem 1rem; }
#bg-canvas { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
#bg-canvas canvas { width: 100%; height: 100%; display: block; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  #bg-canvas { display: none; }
}
CSS

if [ "$TIER" != "static" ]; then
cat > "$DEST/motion.js" << JS
// Motion glue: Lenis + GSAP ScrollTrigger. Tier: $TIER. See web-motion/SKILL.md.
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.getElementById('bg-canvas')?.remove();
} else {
  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    gsap.from(el, { y: 24, opacity: 0, duration: 0.6, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%' } });
  });
}
JS
fi
echo "scaffolded $TIER page in $DEST"
