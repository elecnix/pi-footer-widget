/**
 * Unified footer-widget types for pi.
 *
 * A "footer widget" is a small piece of status content (a usage bar, a quota
 * percent, a clock, …) that an extension wants to appear in the pi footer
 * without replacing it. This library adapts the widget to whichever footer
 * "composer" is installed (pi-statusbar, pi-powerline-footer, or the stock pi
 * footer), so widget providers can be composer-agnostic.
 *
 * The interface is intentionally non-authoritative: a widget *declares* its
 * layout preferences and color intent, but the composer decides what it can
 * actually honor. The bridge reports back what is supported via
 * {@link RegisteredWidget.colorCapability} and {@link RegisteredWidget.accessors}.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Where a widget would like to appear. Composers honor the subset they can;
 * unknown/unsupported placements fall back to the composer's default slot.
 *
 * - `left` / `right` / `secondary`: powerline row hints (pi-powerline-footer).
 * - `line1-right` / `line2-mid`: the stock pi footer's line-1 right gap and
 *   line-2 padding gap. No composer honors these today; a future core
 *   `setFooterSegment` API would.
 * - `line3`: the stock footer's extension-statuses line (always available via
 *   `ctx.ui.setStatus`).
 */
export type WidgetPlacement =
  | "left"
  | "right"
  | "secondary"
  | "line1-right"
  | "line2-mid"
  | "line3";

/** Non-authoritative layout hints. */
export interface LayoutPrefs {
  placement?: WidgetPlacement;
  /** Higher = more important. Composers may use this for fit/truncation order. */
  priority?: number;
  /** Don't render the widget below this visible width. */
  minWidth?: number;
}

/**
 * What the active composer tells the provider about color support.
 *
 * Color fidelity strategy: a widget colorizes "blissfully" (embeds ANSI) when
 * `supportsAnsi` is true. When false, the bridge strips ANSI before emitting so
 * the composer never sees escape sequences it cannot handle. A widget that
 * prefers a single composer-applied color can leave `selfColorize` false and
 * let the composer theme/`customItems.color` decide.
 */
export interface ColorCapability {
  /** Provider may embed ANSI escapes; composer passes them through verbatim. */
  supportsAnsi: boolean;
  /** Composer applies one color per widget. Honored when `selfColorize` is false. */
  supportsPerWidgetColor: boolean;
  /** Known theme color names, if the composer exposes them. */
  themeColors?: string[];
  /** Composer can apply a theme `fg(color, text)` function if the widget wants it. */
  supportsThemeFg?: boolean;
}

/**
 * Lazy accessors the bridge exposes to pull-model providers, adapted from
 * whichever source is available: pi-statusbar's `SectionAccessors` when that
 * composer is active, or the pi `ExtensionContext` otherwise.
 *
 * The bridge sits in the middle so providers get accessors in both push and
 * pull modes.
 */
export interface WidgetAccessors {
  getCwd(): string;
  getModel(): { provider: string; id: string; name?: string } | undefined;
  getThinkingLevel(): string;
  getContextUsage():
    | { percent: number | null; contextWindow: number; tokens: number | null }
    | undefined;
  getGitBranch(): string | null;
  getUsage(): {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
  /** Theme `fg(color, text)` if the composer exposes one; null otherwise. */
  getThemeFg(): ((color: string, text: string) => string) | null;
}

/** A widget a provider registers with the bridge. */
export interface FooterWidget {
  id: string;
  /**
   * Pull model: the composer calls `render` each frame with accessors. Required
   * for pi-statusbar (which is pull-only); optional for push-only providers on
   * other composers.
   */
  render?: (ctx: WidgetAccessors) => string;
  /** Non-authoritative layout hints. */
  layout?: LayoutPrefs;
  /**
   * Provider will embed ANSI color escapes in returned strings. The bridge
   * passes them through when `colorCapability.supportsAnsi` is true and strips
   * them otherwise.
   */
  selfColorize?: boolean;
  /** Re-push / re-render cadence in milliseconds (push model and re-render nudge). */
  refreshMs?: number;
}

/** Handle returned by {@link registerFooterWidget}. */
export interface RegisteredWidget {
  /** Push a new string (push model). Triggers a re-emit/re-render. */
  update(text: string): void;
  /** Accessors available to pull-model `render`; null if none are available. */
  accessors: WidgetAccessors | null;
  /** What the active composer supports for color. */
  colorCapability: ColorCapability;
  /** Stop emitting and unregister from the composer. */
  dispose(): void;
}

/** Internal: the composer kinds the bridge can detect. */
export type ComposerKind = "pi-statusbar" | "pi-powerline-footer" | "stock";

/** Internal: detection result. */
export interface DetectedComposer {
  kind: ComposerKind;
  /** pi-statusbar registry, if present. */
  statusbarRegistry?: {
    register: (section: { id: string; render: (ctx: unknown) => string | undefined }) => void;
  };
}

/** Re-exported so providers don't need a second import for the context type. */
export type { ExtensionContext };