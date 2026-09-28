#!/usr/bin/env python3
"""Sheet views to game-ready GLB via the modeler's Hugging Face Space (TRELLIS.2).

Sends one quadrant of the approved four-view sheet (default: front, top-left) to
roninito/trellis-2: /image_to_3d, then /extract_glb with the decimation target,
downloads the GLB and checks the triangle budget by parsing it. No Blender needed:
face count comes from the GLB itself. Adapter config is environment, not code:
  HF_TOKEN           Hugging Face token (required)
  HF_MODELER_SPACE   Space id (default roninito/trellis-2)

Usage:
  model-from-sheet.py --sheet sheet.png --out model.glb [--view 0 --decimation 20000]
"""
import argparse
import json
import os
import shutil
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hf_space import call_space, report

SPACE = os.environ.get("HF_MODELER_SPACE", "roninito/trellis-2")

# Space UI defaults (Advanced Settings accordion).
SS = (7.5, 0.7, 12, 5.0)
SHAPE = (7.5, 0.5, 12, 3.0)
TEX = (1.0, 0.0, 12, 3.0)


def split_sheet(sheet_path: str, view: int) -> str:
    """Cut the 2x2 sheet into quadrants, return the temp path of one view."""
    from PIL import Image

    img = Image.open(sheet_path).convert("RGB")
    w, h = img.size
    boxes = [(0, 0, w // 2, h // 2), (w // 2, 0, w, h // 2),
             (0, h // 2, w // 2, h), (w // 2, h // 2, w, h)]
    crop = img.crop(boxes[view])
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    crop.save(path)
    return path


def glb_faces(glb_path: str) -> int:
    """Triangle count straight from the GLB JSON chunk (no Blender needed)."""
    with open(glb_path, "rb") as f:
        data = f.read()
    if data[:4] != b"glTF":
        raise ValueError("not a GLB file")
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    accessors = doc.get("accessors", [])
    faces = 0
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                faces += accessors[prim["indices"]]["count"] // 3
            else:
                faces += accessors[prim["attributes"]["POSITION"]]["count"] // 3
    return faces


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--sheet", required=True, help="approved four-view sheet")
    p.add_argument("--out", required=True, help="output .glb path")
    p.add_argument("--view", type=int, default=0, help="quadrant 0=front 1=side 2=back 3=three-quarter")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--resolution", default="1024", choices=["512", "1024", "1536"])
    p.add_argument("--decimation", type=int, default=20000, help="target face count")
    p.add_argument("--texture", type=int, default=2048)
    p.add_argument("--budget", type=int, default=20000, help="triangle budget for this kind")
    a = p.parse_args()

    view_path = split_sheet(a.sheet, a.view)
    print(f"[modeler] {SPACE} :: view {a.view} of {a.sheet}", flush=True)
    from gradio_client import handle_file

    try:
        state, _html = call_space(
            SPACE, "/image_to_3d",
            handle_file(view_path), a.seed, a.resolution,
            *SS, *SHAPE, *TEX,
        )
        print("[modeler] latents ready, extracting GLB...", flush=True)
        glb_path, _dl = call_space(SPACE, "/extract_glb", state, a.decimation, a.texture)
        shutil.copy(glb_path, a.out)
        faces = glb_faces(a.out)
        print(json.dumps({"glb": a.out, "faces": faces, "budget": a.budget}), flush=True)
        report([a.out])
        if faces > a.budget:
            print(f"[modeler] OVER BUDGET: {faces} > {a.budget}", flush=True)
            return 2
        return 0
    finally:
        os.path.exists(view_path) and os.remove(view_path)


if __name__ == "__main__":
    sys.exit(main())
