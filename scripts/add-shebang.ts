/**
 * Post-build script: prepends #!/usr/bin/env node to dist/cli.js
 * and makes it executable.
 * Run with: bun scripts/add-shebang.ts
 */
import { readFileSync, writeFileSync, chmodSync } from "fs";

const file = "dist/cli.js";
const content = readFileSync(file, "utf-8");

if (!content.startsWith("#!/usr/bin/env node")) {
  writeFileSync(file, "#!/usr/bin/env node\n" + content, "utf-8");
}

try {
  chmodSync(file, "755");
} catch {
  // Windows doesn't support chmod — safe to ignore
}

console.log(`Shebang added to ${file}`);
