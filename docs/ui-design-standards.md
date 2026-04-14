# UI Design Standards

Date: 2026-04-14
Scope: `apps/web`

This document turns external design-system guidance into a Phodex-specific UI standard.
It is not meant to copy any one system verbatim. It extracts stable rules, then adapts them to the existing warm-glass mobile shell used in this repo.

## External References

- UICN: [再见8点网格，你好4点网格](https://www.ui.cn/detail/600059.html)
- UICN: [超全面B端设计规范总结](https://m.ui.cn/details/594773)
- UICN: [B端基础 | 栅格设计系统的由来和应用](https://m.ui.cn/details/662432)
- Ant Design: [Font](https://ant.design/docs/spec/font/)
- Ant Design: [Layout](https://ant.design/docs/spec/layout/)
- Ant Design: [Colors](https://4x.ant.design/docs/spec/colors)
- Carbon Design System: [Button](https://carbondesignsystem.com/components/button/style/)
- Carbon Design System: [Color](https://carbondesignsystem.com/elements/color/overview/)
- Apple HIG: [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- Apple HIG: [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- Radix Themes: [Button](https://www.radix-ui.com/themes/docs/components/button)
- Radix Themes: [Radius](https://www.radix-ui.com/themes/docs/theme/radius)

## Stable Rules Extracted From Those Sources

### Spacing

- Use a small base unit and keep layout rhythm predictable.
- UICN and many B-end articles converge on `4px` as a practical base because it is more flexible than a strict `8px` grid in dense interfaces.
- Ant Design uses a restrained spacing rhythm and explicitly calls out `8 / 16 / 24` as the common vertical steps.
- Carbon's 2x grid expresses the same idea differently: spacing and component sizing should sit on a repeatable geometric rhythm.

Phodex rule:

- `4px` is the micro unit.
- `8px` is the default layout step.
- Common gaps and paddings should come from `4 / 8 / 12 / 16 / 20 / 24`.
- Do not introduce one-off values like `13 / 15 / 18 / 22 / 26 / 30` unless there is a clear optical reason.

### Typography

- Ant recommends `14px` as the base size with `22px` line height, and keeps most product interfaces within `3-5` text sizes.
- UICN B-end guidance uses system or modern sans fonts and commonly starts from `14px`, with a minimum around `12px`.
- Apple emphasizes readable default sizes, clear hierarchy, and avoiding thin weights for small text.

Phodex rule:

- Sans family: system-first stack only.
- Mono family: `JetBrains Mono` only for code, command output, paths, and machine-like metadata.
- Type ladder:
  - `display-xl 28/30`: only onboarding/auth hero headlines
  - `display-lg 24/28`: page-level and major empty-state titles
  - `title 18/22`: sheets, dialogs, and dense card titles
  - `body-strong 15/20`: high-emphasis body copy and user message text
  - `body 14/22`: default reading copy
  - `label 12/16`: chips, labels, and helper controls
  - `support 11/14`: secondary explanatory copy
  - `meta 10/12`: eyebrow labels and machine metadata
- Supportive copy inside drawers, cards, helper rows, and footer metadata should usually stay at `10-11px`, not compete with the primary title.
- After auth, avoid oversized prompts: routine empty states, settings/paywall/about headers, and create-sheet guidance should usually top out at `24px`, and dense dialogs should usually top out at `18px`.
- Keep weights to `400 / 500 / 700`.
- Limit a single surface to at most `4-5` visible text sizes.

### Color

- UICN B-end guidance splits color into brand, support, and neutral layers.
- Ant and Carbon both stress role-based color assignment instead of raw hex usage.
- Carbon is especially useful here: neutral layers should create hierarchy, and accent colors should be sparse and semantic.
- Apple also stresses consistent use of color for status and interactivity.

Phodex rule:

- Neutrals dominate the UI.
- Orange is reserved for the most active forward action in the chat workspace.
- Blue is reserved for selected state, info state, and model-selection affordances.
- Green and red are status colors only.
- Text and borders should come from semantic roles, not ad hoc black-opacity mixes.
- New components should prefer tokens like `surface`, `surface-raised`, `surface-dark`, `border-subtle`, `text-primary`, `text-secondary`, `text-tertiary`.

### Radius

- Radix uses a radius scale instead of arbitrary per-component values.
- Apple and Carbon both reinforce that rounded shapes should be consistent and contextual.

Phodex rule:

- Use only these radii for new work:
  - `12px`: icon tiles, tiny inner surfaces
  - `16px`: controls and small cards
  - `20px`: medium cards and chips-with-depth
  - `24px`: sheets, dialogs, and major surfaces
  - `999px`: pills and circular controls
- Do not mix `18 / 22 / 26 / 30` on the same screen unless there is a deliberate reason.

### Buttons

- Apple: touch targets need at least a `44x44pt` hit region and related buttons should use style, not size, to express priority.
- Carbon: a primary action set should have one primary button, and paired buttons should read as a coherent set.
- Carbon button sizes give a practical ladder: `24 / 32 / 40 / 48`.
- Radix shows the same principle in another form: consistent size and radius scales matter more than isolated pixel-perfect values.

Phodex rule:

- We use these button tiers:
  - `28px`: tiny icon affordance
  - `30-32px`: chips and low-emphasis pills
  - `36px`: toolbar / utility circular buttons
  - `40px`: secondary and utility action buttons
  - `48px`: primary CTA buttons
  - `44px`: dense dialog/footer button rows where primary and secondary actions sit side by side
- Paired buttons in the same action row should share the same height.
- Use emphasis through fill, border, and contrast, not by making one option much larger.
- Floating helper buttons may be visually smaller than `44px`, but must preserve an effective `44px` hit region.
- Dense mobile sheets should prefer `44px` paired buttons over mixing a tall primary and a short ghost button.
- In the chat composer, the primary send action should sit on the bottom control baseline with the model/runtime picker, not float inside extra empty whitespace.
- In the chat composer, send and stop controls should be visually centered within the toolbar row, inset slightly from the right edge, and stay around `30px` visually while preserving a larger hit area.
- In the composer action cluster, send and stop should share the same circular `30-32px` outer geometry; state changes should come from fill, border, and elevation instead of switching the container shape.
- The collapsed mobile composer should default to a compact `2`-row writing height unless a richer structured-input state explicitly needs more space.
- In the chat composer, the send control should visually downshift when the textarea is empty; the strong forward-action accent belongs only to a genuinely sendable state.
- Runtime speed selection should live inside the existing model/runtime picker; when `Fast` is active, signal it with a compact bolt badge on that trigger instead of adding a disconnected extra button.

### Icons

- Radix, Carbon, and modern mobile systems all benefit from a single icon language rather than mixing filled, outlined, and ad hoc glyphs.
- The problem is usually not "which icon set" but inconsistent stroke weight, inconsistent optical size, and inconsistent container treatment.

Phodex rule:

- Use one stroke-first SVG system across the app.
- Default stroke weight should stay visually around `1.9`.
- Standard icon sizes should come from `13 / 15 / 16`.
- If one shortcut in a control cluster uses a small icon tile, adjacent shortcuts in the same cluster should use the same treatment.
- Do not mix naked inline icons, white tiles, and circular icon buttons in the same control row unless the semantic role is actually different.

## Phodex Visual Direction

Phodex is not a generic B-end console and not a consumer-marketing app. Its visual language should feel like:

- warm paper-like base surfaces
- restrained monochrome structure
- sparse glass surfaces for overlay and composer areas
- strong but minimal action color
- compact, tool-like controls rather than oversized marketing buttons

This means:

- avoid large white blocks with tiny nested icons
- avoid multiple strong black CTAs on one screen
- avoid oversized menu typography inside dense tools
- avoid using radius, shadow, and size changes all at once to show emphasis

## Tokens To Use In Code

The shared CSS variables should follow these families:

- Typography:
  - `--font-sans`
  - `--font-mono`
  - `--font-size-display-xl`
  - `--font-size-display-lg`
  - `--font-size-title`
  - `--font-size-body`
  - `--font-size-body-strong`
  - `--font-size-support`
  - `--font-size-label`
  - `--font-size-meta`
- Icons:
  - `--icon-stroke`
  - `--icon-size-sm`
  - `--icon-size-md`
  - `--icon-size-lg`
- Radius:
  - `--radius-1`
  - `--radius-2`
  - `--radius-3`
  - `--radius-4`
  - `--radius-pill`
- Controls:
  - `--control-h-tiny`
  - `--control-h-chip`
  - `--control-h-tool`
  - `--control-h-secondary`
  - `--control-h-primary`
  - `--control-h-floating`
- Color roles:
  - `--surface-subtle`
  - `--surface-raised`
  - `--surface-dark`
  - `--border-subtle`
  - `--text-primary`
  - `--text-secondary`
  - `--text-tertiary`
- Shadows:
  - `--shadow-1`
  - `--shadow-2`
  - `--shadow-3`

## Component Mapping

The following components should conform first because they repeat throughout the product:

- `primary-cta`
- `ghost-cta`
- `icon-button`
- `drawer-footer-pill`
- `drawer-settings-bar`
- `drawer-shortcut`
- `drawer-status`
- `model-picker__trigger`
- `send-cta--circle`
- `composer-circle`
- `scroll-latest-cta`
- `thread-create-sheet__mode`
- `thread-create-sheet__target`

## QA Checklist

Before calling a UI pass done:

- No paired action row uses different button heights.
- No floating helper button looks like a large disk with a tiny inner icon.
- No composer primary action looks visually detached from the toolbar baseline or stranded inside surplus blank space.
- No composer send/stop control sits flush against the card edge or hangs below the model-picker centerline.
- No empty composer shows the send control as if it were already actionable.
- No routine in-product prompt surface uses hero-scale typography when a `display-lg` or `title` token would do.
- No popover or menu introduces a larger type scale than the surface around it unless it is a true heading.
- No secondary helper text or connection metadata is visually louder than the primary action on the same surface.
- No control row mixes multiple icon-container treatments without a semantic reason.
- No screen mixes more than `5` radii values.
- No new component uses raw hex or raw rgba if an existing token can represent it.
- Dense overlays are tested with long content, internal scrolling, and visible footer actions.
