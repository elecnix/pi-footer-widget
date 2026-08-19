/**
 * pi-footer-widget — a unified, composer-agnostic footer-widget surface for pi.
 *
 * Widget providers call {@link registerFooterWidget} once; the bridge detects
 * which footer composer is installed (pi-statusbar, pi-powerline-footer, or the
 * stock pi footer) and adapts the widget to it. Providers support push and/or
 * pull, declare non-authoritative layout needs, and learn what color support
 * the composer offers.
 *
 * Goal: become pi's footer extension interface. Today it is a bridge over two
 * third-party composers; when a core `setFooterSegment` API lands, the bridge
 * gains a first-class adapter and providers don't change.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  accessorsFromContext,
  accessorsFromStatusbar,
  detectComposer,
  stripAnsi,
} from "./adapters.ts";
import type {
  ColorCapability,
  DetectedComposer,
  FooterWidget,
  LayoutPrefs,
  RegisteredWidget,
  WidgetAccessors,
  WidgetPlacement,
} from "./types.ts";

export type {
  ColorCapability,
  FooterWidget,
  LayoutPrefs,
  RegisteredWidget,
  WidgetAccessors,
  WidgetPlacement,
};

const STATUSBAR_KEY = "__piStatusbarRegistry";

function colorCapabilityFor(_kind: DetectedComposer["kind"]): ColorCapability {
  // ctx.ui.theme.fg (pi-core) is available on every path, and every composer
  // (and the stock footer's extension-statuses line) passes embedded ANSI
  // through verbatim. So widgets can self-colorize theme-correctly everywhere.
  return { supportsAnsi: true, supportsPerWidgetColor: true, supportsThemeFg: true };
}

/**
 * Register a footer widget with whatever composer is active.
 *
 * - **pi-statusbar** (pull): registers a section via
 *   `globalThis.__piStatusbarRegistry.register`. The widget's `render` is called
 *   each frame with accessors adapted from `SectionAccessors`. Requires
 *   `widget.render`. `update()` nudges a re-render via `setStatus`.
 * - **pi-powerline-footer** / **stock footer** (push): emits the widget string
 *   via `ctx.ui.setStatus(id, text)`. Pull `render` is polled at `refreshMs`
 *   (default 30s) and re-pushed. Users of pi-powerline-footer place the item via
 *   a `powerline.customItems` entry; without one, it lands in the
 *   `extension_statuses` segment. On the stock footer it lands on line 3.
 *
 * Color: if `widget.selfColorize` is true and `colorCapability.supportsAnsi` is
 * false, ANSI is stripped before emitting.
 */
export function registerFooterWidget(
  ctx: ExtensionContext,
  widget: FooterWidget,
): RegisteredWidget {
  const composer = detectComposer();
  const colorCapability = colorCapabilityFor(composer.kind);
  const emit = (raw: string): string => {
    if (widget.selfColorize && !colorCapability.supportsAnsi) return stripAnsi(raw);
    return raw;
  };

  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentText = "";

  // Base accessors from ctx (push path). For pi-statusbar (pull), the per-render
  // callback overrides with composer-adapted accessors.
  const ctxAccessors = accessorsFromContext(ctx);
  let latestAccessors: WidgetAccessors = ctxAccessors;

  const renderWith = (acc: WidgetAccessors): string =>
    widget.render ? widget.render(acc) ?? "" : currentText;

  const push = (raw: string): void => {
    currentText = emit(raw);
    try {
      ctx.ui.setStatus(widget.id, currentText || undefined);
    } catch {
      /* ignore */
    }
  };

  const nudge = (): void => {
    if (widget.render) push(renderWith(latestAccessors));
  };

  if (composer.kind === "pi-statusbar" && composer.statusbarRegistry) {
    // Pull model: composer calls our render each frame.
    composer.statusbarRegistry.register({
      id: widget.id,
      render: (sbCtx: unknown) => {
        const acc = accessorsFromStatusbar(sbCtx);
        // pi-statusbar doesn't expose theme on SectionAccessors, but the bridge
        // has ctx in closure — so providers get ctx.ui.theme.fg here too.
        acc.getThemeFg = ctxAccessors.getThemeFg;
        latestAccessors = acc; // latest accessors available to provider via handle
        const raw = widget.render ? renderWith(acc) : currentText;
        currentText = emit(raw);
        return currentText || undefined;
      },
    });
    // update() nudges a re-render via setStatus (pi-statusbar subscribes to the
    // same render pipeline) and caches the pushed text for the pull callback.
    // refreshMs re-nudges.
  } else {
    // Push model: emit via setStatus now and on a cadence.
    push(renderWith(ctxAccessors));
  }

  if (widget.refreshMs && widget.refreshMs > 0) {
    timer = setInterval(() => {
      if (disposed) return;
      if (composer.kind === "pi-statusbar") {
        // Re-evaluate pull and nudge the pipeline.
        nudge();
      } else if (widget.render) {
        push(renderWith(ctxAccessors));
      }
    }, widget.refreshMs);
  }

  return {
    update(text: string): void {
      if (disposed) return;
      push(text);
    },
    accessors: ctxAccessors,
    colorCapability,
    dispose(): void {
      disposed = true;
      if (timer) clearInterval(timer);
      try {
        ctx.ui.setStatus(widget.id, undefined);
      } catch {
        /* ignore */
      }
    },
  };
}

// Re-export the statusbar registry key for providers that want to introspect.
export { STATUSBAR_KEY as STATUSBAR_REGISTRY_KEY };