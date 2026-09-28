#!/usr/bin/env python3
"""Turnaround sheet via the sheeter's Hugging Face Space (default: FLUX.2-klein demo).

Takes the approved concept image plus the fixed sheet instruction -- not a free
prompt (see conventions/pipeline). Adapter config is environment, not code:
  HF_TOKEN          Hugging Face token (required)
  HF_SHEETER_SPACE  Space id (default roninito/flux2-klein-demo)

Usage:
  edit-sheet.py --image concept.png --prompt "<fixed sheet instruction>" --out sheet.png
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hf_space import call_space, report

SPACE = os.environ.get("HF_SHEETER_SPACE", "roninito/flux2-klein-demo")

SHEET_INSTRUCTION = (
    "Turn this concept into an orthographic turnaround sheet: front, side, back, three-quarter. "
    "Keep proportions, palette, and surface detail identical across all four views. "
    "No background, no shadow, flat lighting."
)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True, help="approved concept image")
    p.add_argument("--prompt", default=SHEET_INSTRUCTION, help="fixed sheet instruction")
    p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=1472)
    p.add_argument("--height", type=int, default=832)
    p.add_argument("--steps", type=int, default=4)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--no-randomize", action="store_true")
    a = p.parse_args()

    print(f"[sheeter] {SPACE} :: editing {a.image}", flush=True)
    from gradio_client import handle_file

    image, seed = call_space(
        SPACE, "/edit",
        handle_file(a.image), a.prompt, a.seed, not a.no_randomize, a.width, a.height, a.steps,
    )
    shutil.copy(image, a.out)
    print(f"[sheeter] seed {seed} -> {a.out}", flush=True)
    report([a.out])
    return 0


if __name__ == "__main__":
    sys.exit(main())
