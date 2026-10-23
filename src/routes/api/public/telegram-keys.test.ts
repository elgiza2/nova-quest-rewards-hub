import { describe, expect, it } from "vitest";

function normalizeProvider(raw: string): "cerebras" | "agentsky" | "browser-use" | null {
  const v = raw.trim().toLowerCase().replace(/_/g, "-");
  if (v === "cerebras" || v === "c") return "cerebras";
  if (v === "agentsky" || v === "agent" || v === "a") return "agentsky";
  if (v === "browser-use" || v === "browseruse" || v === "browser" || v === "b")
    return "browser-use";
  return null;
}

describe("telegram provider routing", () => {
  it("maps buttons and commands to the three chat providers", () => {
    expect(normalizeProvider("keys:provider:cerebras".slice("keys:provider:".length))).toBe(
      "cerebras",
    );
    expect(normalizeProvider("cerebras")).toBe("cerebras");
    expect(normalizeProvider("agentsky")).toBe("agentsky");
    expect(normalizeProvider("browseruse")).toBe("browser-use");
    expect(normalizeProvider("browser-use")).toBe("browser-use");
  });

  it("parses explicit add commands without relying on pending state", () => {
    const add = "/add_browseruse bu-key-123".match(
      /^\/add[_-]?(cerebras|agentsky|agent|browseruse|browser-use|browser)\s+(\S+)\s*$/i,
    );
    expect(add?.[1]).toBe("browseruse");
    expect(add?.[2]).toBe("bu-key-123");
    expect(normalizeProvider(add?.[1] ?? "")).toBe("browser-use");
  });

  it("parses per-provider delete/enable commands", () => {
    const mod = "/del_cerebras 2".match(
      /^\/(del|on)[_-]?(cerebras|agentsky|agent|browseruse|browser-use|browser)?\s+(\d+)\s*$/i,
    );
    expect(mod?.[1]).toBe("del");
    expect(normalizeProvider(mod?.[2] ?? "")).toBe("cerebras");
    expect(mod?.[3]).toBe("2");
  });
});
