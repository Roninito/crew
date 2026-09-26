"""Example job script. Start it with:

    crew job run --task T-0001 --script templates/scripts/example-job.py --timeout 5m \
      --note "Intent: demo. On success: move task to verify. On failure: read run.log."

crew runs this detached, then wakes the agent on job.succeeded / job.failed / job.timeout.
"""
import os
import time

from crew import out_dir, progress, renew, result

steps = 3
for i in range(steps):
    time.sleep(1)
    progress(round((i + 1) / steps * 100), note=f"step {i + 1} of {steps}")
    renew()

path = os.path.join(out_dir(), "hello.txt")
with open(path, "w") as f:
    f.write("hello from a crew job\n")

result(files=[path], steps=steps)
print("done")
