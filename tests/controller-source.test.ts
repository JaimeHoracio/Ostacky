import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const controllerSource = readFileSync(
  join(import.meta.dir, "..", "assets", "mcp", "ostacky-controller", "index.js"),
  "utf-8"
);

describe("ostacky controller lifecycle", () => {
  it("does not terminate a healthy controller merely because it is idle", () => {
    expect(controllerSource).not.toContain("setupWatchdog();");
    expect(controllerSource).not.toContain("watchdog:timeout");
  });

  it("resolves its default state path from the process working directory", () => {
    expect(controllerSource).toContain(
      "const statePath = resolve(process.env.OSTACKY_STATE_PATH || join(process.cwd(), '.opencode', 'ostacky-state.json'));"
    );
  });
});
