import { describe, expect, it } from "bun:test";
import { classifyIntent, isSessionQuestion } from "../src/tiered.ts";
import { projectStateForTool } from "../assets/plugins/ostacky-controller/index.ts";

describe("session question intent", () => {
  const questions = [
    "¿qué hicimos hasta ahora?",
    "que cambiaste en el controller",
    "qué falta para cerrar el change",
    "resumí lo que hicimos",
    "por qué elegiste ese enfoque",
    "cuáles fueron los cambios",
  ];
  for (const q of questions) {
    it(`detecta pregunta de hechos: ${q}`, () => {
      expect(isSessionQuestion(q)).toBe(true);
      expect(classifyIntent(q, "DONE")).toBe("session_question");
    });
  }

  const work = [
    "qué propones para el parser?",
    "¿qué cambiarías en el router?",
    "arreglá el bug del slot",
    "cambiá el título del README",
    "implementá el endpoint de sesiones",
    "qué hicimos? y después continuá con el paso 3",
    "¿qué archivos hay en src/ para el cache?",
  ];
  for (const w of work) {
    it(`NO trata como pregunta de sesión (fail-safe): ${w}`, () => {
      expect(isSessionQuestion(w)).toBe(false);
      expect(classifyIntent(w, "DONE")).toBe("work");
    });
  }

  it("saludo sigue siendo greeting solo en DONE", () => {
    expect(classifyIntent("hola", "DONE")).toBe("greeting");
    expect(classifyIntent("hola", "EXECUTING_INLINE")).toBe("work");
  });

  it("pregunta de sesión también se reconoce durante un flujo activo", () => {
    expect(classifyIntent("qué falta?", "EXECUTING_INLINE")).toBe("session_question");
  });

  it("projectStateForTool expone hechos ejecutados", () => {
    const view = projectStateForTool({
      state: "EXECUTING_INLINE",
      revision: 7,
      expectedTasks: ["T1", "T2", "T3"],
      tasks: { T1: { status: "COMPLETED" }, T2: { status: "PENDING" } },
      fileFingerprints: { "/p/src/a.ts": "x" },
    }) as any;
    expect(view.completedTasks).toEqual(["T1"]);
    expect(view.pendingTasks).toEqual(["T2", "T3"]);
    expect(view.editedFiles).toEqual(["/p/src/a.ts"]);
  });
});
