/**
 * Composer detection + accessor adaptation.
 *
 * Detection is best-effort and based on the globals each composer publishes:
 * - pi-statusbar: `globalThis.__piStatusbarRegistry` (plain string key).
 * - pi-powerline-footer: `globalThis[Symbol.for("powerlinePromptHistoryTracked")]`
 *   (an internal symbol it sets during load). This is fragile by design — the
 *   bridge degrades safely to "stock" if the symbol disappears.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DetectedComposer, WidgetAccessors } from "./types.ts";

const STATUSBAR_KEY = "__piStatusbarRegistry";
const POWERLINE_LOADED = Symbol.for("powerlinePromptHistoryTracked");

export function detectComposer(): DetectedComposer {
  const g = globalThis as Record<string | symbol, unknown>;
  const sb = g[STATUSBAR_KEY] as
    | { register?: (s: { id: string; render: (ctx: unknown) => string | undefined }) => void }
    | undefined;
  if (sb?.register) {
    return { kind: "pi-statusbar", statusbarRegistry: { register: sb.register.bind(sb) } };
  }
  if (Reflect.get(g, POWERLINE_LOADED) === true) {
    return { kind: "pi-powerline-footer" };
  }
  return { kind: "stock" };
}

/**
 * Build {@link WidgetAccessors} from a pi {@link ExtensionContext} (push path:
 * pi-powerline-footer / stock footer). Aggregates usage from the session branch
 * the same way the stock footer does.
 */
export function accessorsFromContext(ctx: ExtensionContext): WidgetAccessors {
  const getUsage = () => {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    for (const e of ctx.sessionManager.getBranch() as Iterable<{
      type: string;
      message?: { role?: string; usage?: Record<string, number> };
    }>) {
      if (e.type === "message" && e.message?.role === "assistant") {
        const u = e.message.usage;
        if (u) {
          input += u.input ?? 0;
          output += u.output ?? 0;
          cacheRead += u.cacheRead ?? 0;
          cacheWrite += u.cacheWrite ?? 0;
          cost += u.cost ?? 0;
        }
      }
    }
    return { input, output, cacheRead, cacheWrite, cost };
  };
  const themeFg =
    (): ((color: string, text: string) => string) | null => {
      const t = ctx.ui?.theme;
      if (!t?.fg) return null;
      return (color: string, text: string) => t.fg(color as never, text);
    };
  return {
    getCwd: () => ctx.sessionManager.getCwd() ?? ctx.cwd,
    getModel: () => ctx.model ?? undefined,
    getThinkingLevel: () => ctx.thinkingLevel ?? "off",
    getContextUsage: () => {
      const cu = ctx.getContextUsage?.();
      if (!cu) return undefined;
      return {
        percent: cu.percent ?? null,
        contextWindow: cu.contextWindow ?? 0,
        tokens: cu.tokens ?? null,
      };
    },
    getGitBranch: () => null, // stock path doesn't expose git; pi-statusbar path does
    getUsage,
    getThemeFg: themeFg,
  };
}

/**
 * Adapt pi-statusbar's `SectionAccessors` (pull path) into
 * {@link WidgetAccessors}. Fields are mapped defensively; missing accessors
 * degrade to null/0.
 */
export function accessorsFromStatusbar(sbCtx: unknown): WidgetAccessors {
  const c = sbCtx as Record<string, () => unknown>;
  const call = <T,>(k: string): T | undefined => (typeof c[k] === "function" ? (c[k] as () => T)() : undefined);
  return {
    getCwd: () => (call<string>("getCwd") as string) ?? process.cwd(),
    getModel: () => call("getModel") as { provider: string; id: string; name?: string } | undefined,
    getThinkingLevel: () => (call<string>("getThinkingLevel") as string) ?? "off",
    getContextUsage: () =>
      call("getContextUsage") as
        | { percent: number | null; contextWindow: number; tokens: number | null }
        | undefined,
    getGitBranch: () => {
      const git = call<{ branch?: string }>("getGit");
      return git?.branch ?? null;
    },
    getUsage: () => {
      const u = call<Record<string, number>>("getUsage");
      return {
        input: u?.input ?? 0,
        output: u?.output ?? 0,
        cacheRead: u?.cacheRead ?? 0,
        cacheWrite: u?.cacheWrite ?? 0,
        cost: u?.cost ?? 0,
      };
    },
    getThemeFg: () => null, // not exposed by pi-statusbar today (see issue #2)
  };
}

/** Strip ANSI SGR escapes from a string. Used when the composer can't pass them through. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}