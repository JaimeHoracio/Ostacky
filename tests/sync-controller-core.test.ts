import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf-8");

describe("sync-controller-core — mirrors de compactación", () => {
  it("--check pasa: los mirrors generados coinciden con src/", () => {
    const run = Bun.spawnSync({
      cmd: ["bun", "run", join(root, "scripts", "sync-controller-core.ts"), "--check"],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
  });

  it("compaction-threshold.ts y compaction-assist.ts están marcados como NO EDITAR", () => {
    for (const rel of [
      "assets/plugins/ostacky-controller/compaction-threshold.ts",
      "assets/plugins/ostacky-controller/compaction-assist.ts",
    ]) {
      const mirror = read(rel);
      expect(mirror).toContain("NO EDITAR");
      expect(mirror).toContain("bun run scripts/sync-controller-core.ts");
    }
  });

  it("el mirror de compaction-assist reproduce la máquina de estados canónica", () => {
    const src = read("src/compaction-assist.ts");
    const mirror = read("assets/plugins/ostacky-controller/compaction-assist.ts");
    // El mirror es el canónico con un header de dos líneas delante.
    expect(mirror.endsWith(src)).toBe(true);
    expect(mirror).toContain("compacting");
    expect(mirror).toContain("pending");
    expect(mirror).toContain("stale");
  });

  it("el plugin importa los mirrors, no copias locales", () => {
    const plugin = read("assets/plugins/ostacky-controller/index.ts");
    expect(plugin).toContain('from "./compaction-threshold.ts"');
    expect(plugin).toContain('from "./compaction-assist.ts"');
  });
});
