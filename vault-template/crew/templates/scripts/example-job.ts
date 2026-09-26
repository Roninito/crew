// Example Bun job script. Start it with:
//   crew job run --task T-0001 --script templates/scripts/example-job.ts --timeout 5m
const { progress, result, outDir } = await import(`${process.env.CREW_HELPERS}/bun/crew.ts`);

for (let i = 1; i <= 3; i++) {
  await Bun.sleep(1000);
  progress(Math.round((i / 3) * 100), `step ${i} of 3`);
}
const path = `${outDir()}/hello.txt`;
await Bun.write(path, "hello from a crew job\n");
result({ files: [path], steps: 3 });
console.log("done");
