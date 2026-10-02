// Corre cada tests/*.test.ts en su propio proceso con timeout.
//
// Por qué existe: `bun test` comparte un único global/module-registry entre
// archivos. Un mock global (p.ej. mock.module('child_process')) combinado con
// uso real del mismo módulo en otro archivo puede dejar el runner girando en
// un loop de CPU para siempre (visto con scope-spaces + stack). Procesos
// separados + timeout contienen cualquier cuelgue a un solo archivo.
//
// Uso: bun run test:safe  (env OSTACKY_TEST_TIMEOUT_MS, default 120000)
import { readdirSync } from "node:fs";
import { join } from "node:path";

const TIMEOUT_MS = Number(process.env.OSTACKY_TEST_TIMEOUT_MS ?? 120_000);
const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

if (files.length === 0) {
  console.error("test:safe: no se encontraron tests/*.test.ts");
  process.exit(1);
}

const failed: string[] = [];
for (const f of files) {
  const path = join("tests", f);
  console.log(`\n=== ${path} ===`);
  const proc = Bun.spawn(["bun", "test", "--isolate", path], {
    stdout: "inherit",
    stderr: "inherit",
  });
  // clearTimeout: sin esto el timer pendiente mantiene vivo el event loop
  // hasta TIMEOUT_MS aunque el test ya haya terminado.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([
    proc.exited.then(() => true),
    new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
  if (!exited) {
    console.error(`TIMEOUT tras ${TIMEOUT_MS}ms: matando ${path}`);
    proc.kill();
    await proc.exited.catch(() => {});
    failed.push(`${path} (timeout)`);
    continue;
  }
  if (proc.exitCode !== 0) {
    failed.push(`${path} (exit ${proc.exitCode})`);
  }
}

if (failed.length > 0) {
  console.error(`\ntest:safe: fallaron ${failed.length}/${files.length} archivos:`);
  for (const f of failed) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`\ntest:safe: OK (${files.length} archivos)`);
