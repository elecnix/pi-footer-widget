# pi-footer-widget

A **composer-agnostic footer-widget surface** for the [pi coding agent](https://github.com/earendil-works/pi). A widget provider calls one function and the bridge adapts the widget to whichever footer "composer" is installed — [pi-statusbar](https://github.com/kreeger/pi-statusbar), [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer), or the stock pi footer — so providers don't replace the footer and don't hardcode against a single composer.

> **Goal:** become pi's footer extension interface. Today this is a bridge over two third-party composers; when a core `setFooterSegment` API lands upstream, the bridge gains a first-class adapter and providers don't change.

## Why

`ctx.ui.setFooter()` replaces the entire footer. Every extension that wants a footer widget either clobbers the default (losing session name, stats, provider prefix, thinking level, extension statuses) or fights other extensions for the one `setFooter` slot. Two composers already solve this, but with **incompatible interfaces**:

- **pi-statusbar** — pull model: `globalThis.__piStatusbarRegistry.register({ id, render(ctx) })` with lazy `SectionAccessors`. No `extension_statuses` line, so `setStatus` alone is invisible there.
- **pi-powerline-footer** — push model: standard `ctx.ui.setStatus(key, value)` + a `powerline.customItems` config entry. Degrades to the stock footer's line 3 without the composer.

This library sits in the middle so a provider writes once and reaches both (and the stock footer).

## Install

```bash
pi install npm:pi-footer-widget
```

Or as an npm dependency of your extension (recommended for providers):

```json
{ "dependencies": { "pi-footer-widget": "^0.1.0" } }
```

## Usage

```ts
import { registerFooterWidget } from "pi-footer-widget";

pi.on("session_start", (_event, ctx) => {
  if (!ctx.hasUI) return;
  let last = "5h ▕██░░░░░░▏ 0%";

  const reg = registerFooterWidget(ctx, {
    id: "ollama-cloud",
    render: () => last,        // pull: composer calls us each frame
    selfColorize: true,        // we embed ANSI; bridge strips if unsupported
    layout: { placement: "right", priority: 60, minWidth: 20 },
    refreshMs: 300_000,
  });

  // push a new value whenever your data changes:
  reg.update("5h ▕██████░░▏ 65%  7d ▕████████░▏ 94%");
});
```

### Push vs pull — offer both

- **Pull** (`widget.render`): the composer calls `render(accessors)` each frame. Required for **pi-statusbar** (pull-only). Best when the widget is cheap to compute or wants live accessors.
- **Push** (`reg.update(text)`): the provider pushes a string when its data changes; the bridge re-emits via `ctx.ui.setStatus`. Works for **pi-powerline-footer** and the **stock footer**. If only `render` is provided on the push path, the bridge polls it at `refreshMs` and re-pushes.

You can provide both: `render` for pull composers, and call `update()` when your data changes for push composers.

## What the composer reports back

```ts
interface RegisteredWidget {
  update(text: string): void;
  accessors: WidgetAccessors | null;     // null on pi-statusbar handle; live in render
  colorCapability: ColorCapability;
  dispose(): void;
}

interface ColorCapability {
  supportsAnsi: boolean;          // may embed ANSI; bridge strips if false
  supportsPerWidgetColor: boolean;// composer applies one color per widget
  themeColors?: string[];
  supportsThemeFg?: boolean;
}
```

- **Color fidelity:** colorize blissfully via `acc.getThemeFg()(color, text)` (backed by pi-core `ctx.ui.theme.fg`). Every composer — and the stock footer's extension-statuses line — passes embedded ANSI through verbatim, so per-widget, per-threshold color (green/yellow/red) survives everywhere today. `supportsAnsi` and `supportsThemeFg` are always true. If you prefer a single composer-applied color, leave `selfColorize` false and let the composer theme / `customItems.color` decide.
- **Accessors:** the bridge builds `WidgetAccessors` from `ExtensionContext` on the push path and from pi-statusbar's `SectionAccessors` on the pull path — so providers get accessors in both modes. `getThemeFg()` is non-null whenever `ctx.ui.theme.fg` is available (always, in practice).

## Layout declaration (non-authoritative)

```ts
interface LayoutPrefs {
  placement?: "left" | "right" | "secondary" | "line1-right" | "line2-mid" | "line3";
  priority?: number;   // higher = more important
  minWidth?: number;
}
```

These are **hints**. The composer honors what it can:

| Placement | pi-statusbar | pi-powerline-footer | stock footer |
|---|---|---|---|
| `left`/`right`/`secondary` | — (single ordered line; user uses `sections`) | ✓ via `customItems.position` | — |
| `line1-right` / `line2-mid` | — | — | — (needs core `setFooterSegment`) |
| `line3` | — | ✓ (`extension_statuses`) | ✓ (extension statuses) |

`priority` and `minWidth` are ignored by both composers today (no fit/truncation API) but are declared so a future core API or a richer composer can use them without providers changing.

## Configuration per composer

- **pi-statusbar:** add the widget `id` to the `sections` array in `~/.pi/agent/statusbar.json`.
- **pi-powerline-footer:** add a `customItems` entry in pi settings:
  ```json
  { "powerline": { "customItems": [
    { "id": "ollama", "statusKey": "ollama-cloud", "position": "right", "color": "warning" }
  ]}}
  ```
- **Stock footer:** nothing to configure; the widget appears on the extension-statuses line.

## Limitations & follow-ups

- **Per-threshold color** (green/yellow/red within one widget) is lost on the stock footer (one dim color). It is preserved on pi-statusbar and pi-powerline-footer when `selfColorize` is true, but both composers apply a single theme/item color unless they pass ANSI through. Filed:
  - [kreeger/pi-statusbar#2](https://github.com/kreeger/pi-statusbar/issues/2) — `selfColorize` + theme accessors.
  - [nicobailon/pi-powerline-footer#176](https://github.com/nicobailon/pi-powerline-footer/issues/176) — `selfColorize` + theme push.
- **Detection of pi-powerline-footer** is best-effort (an internal symbol). If the symbol changes, the bridge falls back to "stock" — `setStatus` still works, only the color-capability report changes.
- **`line1-right` / `line2-mid`** placements are not honored by any current composer; they're declared for the future core `setFooterSegment` API (see [earendil-works/pi#6509](https://github.com/earendil-works/pi/issues/6509)).

## API

See [`src/types.ts`](src/types.ts) for the full interface.

## Develop

```bash
npm install
npm test         # vitest
npm run typecheck
```

## License

MIT