import { describe, expect, test } from "bun:test";
import { parseSessionListTitle } from "../src/session-slots";

const LIST = JSON.stringify([
  { id: "ses_A", title: "  Refactor login  ", updated: 1, created: 1, projectId: "p", directory: "/x" },
  { id: "ses_B", title: "Untitled session", updated: 1, created: 1, projectId: "p", directory: "/x" },
  { id: "ses_C", title: "", updated: 1, created: 1, projectId: "p", directory: "/x" },
]);

describe("parseSessionListTitle", () => {
  test("devuelve el título recortado de la sesión pedida", () => {
    expect(parseSessionListTitle(LIST, "ses_A")).toBe("Refactor login");
  });
  test("'Untitled session' y títulos vacíos no cuentan como nombre", () => {
    expect(parseSessionListTitle(LIST, "ses_B")).toBeNull();
    expect(parseSessionListTitle(LIST, "ses_C")).toBeNull();
  });
  test("sesión ausente, JSON inválido o forma inesperada → null", () => {
    expect(parseSessionListTitle(LIST, "ses_Z")).toBeNull();
    expect(parseSessionListTitle("no json", "ses_A")).toBeNull();
    expect(parseSessionListTitle('{"id":"ses_A"}', "ses_A")).toBeNull();
  });
  test("recorta títulos largos a 120 caracteres", () => {
    const long = JSON.stringify([{ id: "s", title: "x".repeat(300) }]);
    expect(parseSessionListTitle(long, "s")!.length).toBe(120);
  });
});
