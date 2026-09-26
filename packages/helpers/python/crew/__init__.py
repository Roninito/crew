"""Helpers for Python job scripts run by `crew job run`.

    from crew import emit, progress, result, renew, log, out_dir

`crew job exec` puts this package on PYTHONPATH and sets CREW_* environment variables.
"""
import json
import os
import subprocess
import sys

__all__ = ["emit", "progress", "result", "renew", "log", "out_dir"]


def _crew(*args: str) -> None:
    # CREW_BUN is the running binary's own real path -- set unconditionally by crew job exec,
    # dev mode or compiled -- so always prefer it over a bare "crew" that depends on PATH.
    bun = os.environ.get("CREW_BUN") or "crew"
    cli = os.environ.get("CREW_CLI")
    cmd = [bun, cli, *args] if cli else [bun, *args]
    r = subprocess.run(cmd, capture_output=True, text=True, env=os.environ)
    if r.returncode != 0:
        print(f"[crew] {args[0]} failed: {r.stderr.strip()}", file=sys.stderr)


def emit(event_type: str, **data) -> None:
    """Send a custom or progress event, e.g. emit("job.progress", pct=40)."""
    full = event_type if "." in event_type else f"job.{event_type}"
    payload = {"job": os.environ.get("CREW_JOB_ID"), **data}
    _crew("emit", full, "--data", json.dumps(payload))


def progress(pct: float, note: str = "") -> None:
    emit("job.progress", pct=pct, note=note)


def result(**data) -> None:
    """Write result.json. Use files=[...] for produced paths; everything is passed to the agent on wake."""
    job_dir = os.environ.get("CREW_JOB_DIR")
    if not job_dir:
        raise RuntimeError("CREW_JOB_DIR not set; run this script through `crew job run`.")
    with open(os.path.join(job_dir, "result.json"), "w") as f:
        json.dump(data, f, indent=2)


def renew() -> None:
    """Keep the task claim alive during long jobs."""
    task = os.environ.get("CREW_TASK")
    if task:
        _crew("renew", task)


def log(text: str) -> None:
    _crew("log", text)


def out_dir() -> str:
    """Folder for output files; everything here is listed on wake."""
    return os.environ.get("CREW_JOB_OUT", ".")
