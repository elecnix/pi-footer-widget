import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { stripAnsi, accessorsFromStatusbar, detectComposer } from "../src/adapters.ts";
import { registerFooterWidget } from "../src/index.ts";

// ANSI helper: red bold "hi"
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const colored = `${RED}hi${RESET}`;

describe("stripAnsi", () => {
  it("removes SGR escapes", () => {
    expect(stripAnsi(colored)).toBe("hi");
  });
  it("leaves plain text untouched", () => {
    expect(stripAnsi("5h ▕██░░▏ 20%")).toBe("5h ▕██░░▏ 20%");
  });
});

describe("accessorsFromStatusbar", () => {
  it("maps known accessors defensively", () => {
    const sbCtx = {
      getCwd: () => "/tmp/x",
      getModel: () => ({ provider: "openrouter", id: "glm-5.2", name: "GLM 5.2" }),
      getThinkingLevel: () => "high",
      getContextUsage: () => ({ percent: 42, contextWindow: 1_000_000, tokens: 420_000 }),
      getGit: () => ({ branch: "main" }),
      getUsage: () => ({ input: 10, output: 20, cacheRead: 5, cacheWrite: 0, cost: 0.1 }),
    };
    const a = accessorsFromStatusbar(sbCtx);
    expect(a.getCwd()).toBe("/tmp/x");
    expect(a.getModel()?.id).toBe("glm-5.2");
    expect(a.getThinkingLevel()).toBe("high");
    expect(a.getContextUsage()?.percent).toBe(42);
    expect(a.getGitBranch()).toBe("main");
    expect(a.getUsage().input).toBe(10);
    expect(a.getThemeFg()).toBeNull();
  });

  it("degrades on empty ctx", () => {
    const a = accessorsFromStatusbar({});
    expect(a.getThinkingLevel()).toBe("off");
    expect(a.getGitBranch()).toBeNull();
    expect(a.getUsage().input).toBe(0);
  });
});

describe("detectComposer", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__piStatusbarRegistry;
    Reflect.deleteProperty(globalThis, Symbol.for("powerlinePromptHistoryTracked"));
  });

  it("detects pi-statusbar", () => {
    (globalThis as Record<string, unknown>).__piStatusbarRegistry = {
      register: () => {},
    };
    expect(detectComposer().kind).toBe("pi-statusbar");
  });

  it("detects pi-powerline-footer", () => {
    Reflect.set(globalThis, Symbol.for("powerlinePromptHistoryTracked"), true);
    expect(detectComposer().kind).toBe("pi-powerline-footer");
  });

  it("falls back to stock", () => {
    expect(detectComposer().kind).toBe("stock");
  });
});

describe("registerFooterWidget", () => {
  type Ctx = Parameters<typeof registerFooterWidget>[0];

  function makeCtx(): Ctx & { setStatusCalls: Array<[string, string | undefined]> } {
    const setStatusCalls: Array<[string, string | undefined]> = [];
    const ctx = {
      cwd: "/tmp",
      model: { provider: "openrouter", id: "glm-5.2" },
      getThinkingLevel: () => "off",
      getContextUsage: () => ({ percent: 10, contextWindow: 1_000_000, tokens: 100_000 }),
      sessionManager: {
        getCwd: () => "/tmp",
        getBranch: () => [] as { type: string; message?: { role?: string; usage?: Record<string, number> } }[],
      },
      ui: {
        setStatus: (k: string, v: string | undefined) => setStatusCalls.push([k, v]),
      },
      hasUI: true,
      setStatusCalls,
    } as unknown as Ctx & { setStatusCalls: Array<[string, string | undefined]> };
    return ctx;
  }

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__piStatusbarRegistry;
    Reflect.deleteProperty(globalThis, Symbol.for("powerlinePromptHistoryTracked"));
  });

  it("push path emits via setStatus and strips ANSI when unsupported (stock)", () => {
    const ctx = makeCtx();
    const reg = registerFooterWidget(ctx, {
      id: "ollama-cloud",
      render: () => colored,
      selfColorize: true,
    });
    // stock composer: supportsAnsi is false → ANSI stripped
    expect(ctx.setStatusCalls[0]?.[0]).toBe("ollama-cloud");
    expect(ctx.setStatusCalls[0]?.[1]).toBe("hi");
    expect(reg.colorCapability.supportsAnsi).toBe(false);
    reg.dispose();
    const last = ctx.setStatusCalls.at(-1);
    expect(last?.[0]).toBe("ollama-cloud");
    expect(last?.[1]).toBeUndefined();
  });

  it("push path keeps ANSI when supported (powerline)", () => {
    Reflect.set(globalThis, Symbol.for("powerlinePromptHistoryTracked"), true);
    const ctx = makeCtx();
    const reg = registerFooterWidget(ctx, {
      id: "ollama-cloud",
      render: () => colored,
      selfColorize: true,
    });
    expect(reg.colorCapability.supportsAnsi).toBe(true);
    expect(ctx.setStatusCalls[0]?.[1]).toBe(colored);
    reg.dispose();
  });

  it("pull path registers with pi-statusbar and reports supportsAnsi", () => {
    const holder: {
      value: { id: string; render: (ctx: unknown) => string | undefined } | null;
    } = { value: null };
    (globalThis as Record<string, unknown>).__piStatusbarRegistry = {
      register: (s: { id: string; render: (ctx: unknown) => string | undefined }) => {
        holder.value = s;
      },
    };
    const ctx = makeCtx();
    const reg = registerFooterWidget(ctx, {
      id: "ollama-cloud",
      render: () => "5h ▕██░░▏ 20%",
      selfColorize: true,
    });
    expect(holder.value?.id).toBe("ollama-cloud");
    expect(reg.colorCapability.supportsAnsi).toBe(true);
    // pull callback returns the render result
    expect(holder.value?.render({})).toBe("5h ▕██░░▏ 20%");
    reg.dispose();
  });

  it("update() pushes a new string", () => {
    const ctx = makeCtx();
    const reg = registerFooterWidget(ctx, { id: "w", render: () => "old" });
    reg.update("new");
    expect(ctx.setStatusCalls.at(-1)?.[1]).toBe("new");
    reg.dispose();
  });
});