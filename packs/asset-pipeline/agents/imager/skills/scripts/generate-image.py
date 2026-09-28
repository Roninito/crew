#!/usr/bin/env python3
"""Text-to-image via the imager's Hugging Face Space (default: FLUX.1-schnell demo).

Adapter config is environment, not code:
  HF_TOKEN         Hugging Face token (required)
  HF_IMAGER_SPACE  Space id (default roninito/flux-schnell-demo)

Usage:
  generate-image.py --prompt "..." --out concept.png [--width 1024 --height 1024 --steps 4]
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hf_space import call_space, report

SPACE = os.environ.get("HF_IMAGER_SPACE", "roninito/flux-schnell-demo")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--prompt", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=1024)
    p.add_argument("--steps", type=int, default=4)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--no-randomize", action="store_true")
    a = p.parse_args()

    print(f"[imager] {SPACE} :: {a.prompt[:120]}", flush=True)
    image, seed = call_space(
        SPACE, "/generate",
        a.prompt, a.seed, not a.no_randomize, a.width, a.height, a.steps,
    )
    shutil.copy(image, a.out)
    print(f"[imager] seed {seed} -> {a.out}", flush=True)
    report([a.out])
    return 0


if __name__ == "__main__":
    sys.exit(main())
