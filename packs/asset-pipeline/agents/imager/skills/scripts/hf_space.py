"""Shared helper: call a private Gradio Space, waking it first if it's asleep.

ZeroGPU Spaces sleep when idle. A cold API call fails, so this wakes the Space
with `hf spaces restart` and polls until RUNNING before (re)trying the call.
Requires the `hf` CLI on PATH and HF_TOKEN in the environment.
"""

import json
import os
import shutil
import subprocess
import time

HF_TOKEN = os.environ.get("HF_TOKEN")
if not HF_TOKEN:
    raise SystemExit("error: HF_TOKEN is not set. export HF_TOKEN=$(hf auth token)")


def space_stage(space_id: str) -> str:
    r = subprocess.run(
        ["hf", "spaces", "info", space_id, "--format", "json"],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise RuntimeError(f"hf spaces info {space_id} failed: {r.stderr.strip()}")
    return json.loads(r.stdout).get("runtime", {}).get("stage", "UNKNOWN")


def ensure_awake(space_id: str, timeout_s: int = 900) -> None:
    """Restart a sleeping Space and wait until RUNNING. No-op if already up."""
    if space_stage(space_id) == "RUNNING":
        return
    print(f"[{space_id}] not running, restarting...", flush=True)
    r = subprocess.run(["hf", "spaces", "restart", space_id], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"hf spaces restart {space_id} failed: {r.stderr.strip()}")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        stage = space_stage(space_id)
        print(f"[{space_id}] stage: {stage}", flush=True)
        if stage == "RUNNING":
            return
        if stage in ("PAUSED", "STOPPED", "ERROR", "BUILD_ERROR"):
            raise RuntimeError(f"Space {space_id} is {stage}; fix it on huggingface.co first.")
        time.sleep(20)
    raise RuntimeError(f"Space {space_id} didn't reach RUNNING in time.")


def gradio_client(space_id: str):
    from gradio_client import Client

    if not shutil.which("hf"):
        raise SystemExit("error: the `hf` CLI is required on PATH for Space wake-ups.")
    ensure_awake(space_id)
    return Client(space_id, token=HF_TOKEN)


def call_space(space_id: str, api_name: str, *args):
    """Predict, waking + retrying once if the Space was asleep mid-call."""
    client = gradio_client(space_id)
    try:
        return client.predict(*args, api_name=api_name)
    except Exception as e:
        if "sleep" in str(e).lower() or "503" in str(e):
            print(f"[{space_id}] call hit a sleeping Space, waking and retrying...", flush=True)
            ensure_awake(space_id)
            return gradio_client(space_id).predict(*args, api_name=api_name)
        raise


def report(files):
    """Tell crew what was produced, when running as a crew job; plain print otherwise."""
    try:
        from crew import result  # type: ignore

        result(files=files)
    except Exception:
        pass
    print(f"produced: {', '.join(files)}", flush=True)
