---
name: Intersection
description: One live 3D intersection, two signal controllers, every decision observable.
colors:
  background: "oklch(0.135 0.005 255)"
  foreground: "oklch(0.96 0.003 255)"
  card: "oklch(0.175 0.006 255)"
  popover: "oklch(0.205 0.007 255)"
  panel: "oklch(0.165 0.006 255 / 0.94)"
  primary: "oklch(0.96 0.003 255)"
  primary-foreground: "oklch(0.17 0.006 255)"
  secondary: "oklch(0.245 0.007 255)"
  muted: "oklch(0.235 0.007 255)"
  accent: "oklch(0.27 0.008 255)"
  muted-foreground: "oklch(0.76 0.01 255)"
  subtle-foreground: "oklch(0.64 0.012 255)"
  border: "oklch(1 0 0 / 10%)"
  input: "oklch(1 0 0 / 15%)"
  ring: "oklch(0.88 0.03 255)"
  signal-red: "oklch(0.645 0.215 27)"
  signal-amber: "oklch(0.83 0.165 78)"
  signal-green: "oklch(0.78 0.17 152)"
  group-ns: "oklch(0.79 0.115 218)"
  group-ew: "oklch(0.74 0.15 305)"
  jev: "oklch(0.9 0.045 85)"
  safety: "oklch(0.77 0.035 245)"
  emergency: "oklch(0.7 0.19 15)"
  positive: "oklch(0.78 0.13 160)"
  warning: "oklch(0.82 0.14 75)"
  destructive: "oklch(0.68 0.19 25)"
  chart-ns: "#00a4c0"
  chart-ew: "#8048b6"
  chart-fixed: "#3987e5"
  chart-ai: "#d95926"
  chart-grid: "oklch(1 0 0 / 8%)"
  scene-base: "oklch(0.185 0.006 255)"
  scene-asphalt: "oklch(0.26 0.005 255)"
  scene-sidewalk: "oklch(0.37 0.006 255)"
  scene-curb: "oklch(0.46 0.006 255)"
  scene-marking: "oklch(0.93 0.004 255)"
  scene-planting: "oklch(0.34 0.045 150)"
  scene-foliage: "oklch(0.45 0.07 148)"
  scene-building: "oklch(0.31 0.007 255)"
  scene-signal-housing: "oklch(0.2 0.004 255)"
  scene-key-light: "oklch(0.99 0.012 85)"
typography:
  wordmark:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 640
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.375rem, 2.2vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  page-title:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title-sm:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.25
  body-lg:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  body-sm:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.375
  label:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  micro:
    fontFamily: "Overpass Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1
  readout:
    fontFamily: "Overpass Mono Variable, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    fontFeature: "\"tnum\""
rounded:
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  xl: "0.7rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  button-run:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
    width: "100%"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.muted}"
  nav-link:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  nav-link-active:
    textColor: "{colors.foreground}"
  card-mode:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "20px"
  panel-floating:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "16px"
  card-agent:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "12px"
  badge-provenance:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "0 8px"
    height: "20px"
  signal-chip:
    textColor: "{colors.foreground}"
    typography: "{typography.readout}"
    rounded: "{rounded.md}"
    padding: "4px 6px"
  tabs-line:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    height: "44px"
---

# Design System: Intersection

## Overview

**Creative North Star: "The Lit Scale Model"**

A scale model of one intersection sits under a lamp in a dark room. The interface is the room: near-black, cool-neutral, quiet, built so the lit model is the brightest and most colourful thing on screen. Panels are low-contrast slabs with hairline borders that hold just enough text to explain what the model is doing. The system was built to the user's own brief, "something simple that is easy to make, easy to understand and presents everything it needs to present", and it reads that way: familiar shadcn/Base UI primitives, one type family, and no decorative layer.

Colour is reserved for meaning. Every hue in the UI encodes something the visitor can also find in the scene: the state of a signal, which movement group (and which agent) a number belongs to, JEV, the safety gate, an emergency vehicle, or a status outcome. Everything else is a step on a single cool-grey ramp (hue 255). Density is moderate. Home is airy and presenter-friendly, and the simulation rail is denser so it reads at laptop distance.

Every visual decision is a token in `src/index.css`, including the 3D scene, which resolves its `--scene-*` and semantic colours at runtime. The team plans a new visual language later, so treat restyling as a token swap and never as a component rewrite.

**Key Characteristics:**
- Dark, cool-neutral chrome (hue 255) around a lit 3D diorama that stays dominant.
- Hue only where it means something: signal, movement group, participant, status.
- Overpass for everything, Overpass Mono for clocks, IDs and readouts.
- Hairline 10% white borders and tonal steps. Soft ambient shadows appear only on surfaces that float.
- Provenance (mock, live, rule-based, simulation) is always visible next to model output.

## Colors

The palette is a cool near-black neutral ramp plus a small set of semantic hues, each of which keeps a single meaning across the scene, charts, timeline and panels.

### Primary
- **Lamp White** (`primary`): solid fill for the main action (Run, Pause/Play) with near-black `primary-foreground` text. The inverted white button is the only filled control on a screen, so it reads as the one thing to press. It shares its value with `foreground`.

### Secondary
- **Signal Red / Signal Amber / Signal Green** (`signal-red`, `signal-amber`, `signal-green`): signal state only. They colour the lamps in the HUD and strip, the fixed-cycle diagram, the N/S and E/W rows of the timeline, and the 3D signal heads. In the bar charts, red is drawn at reduced strength so that green, the active state, carries the row.
- **North/South Cyan** (`group-ns`): the North/South movement group and Agent A, wherever either appears (identity dots, agent card subtitle, pipeline diagram node, timeline lane, queue stat, text selection tint).
- **East/West Violet** (`group-ew`): the East/West movement group and Agent B, applied the same way.

### Tertiary
- **JEV Warm White** (`jev`): JEV, the arbitration model, as its dot, diagram node and timeline lane.
- **Safety Steel** (`safety`): the deterministic safety gate and the "Rule-based" provenance badge.
- **Emergency Rose** (`emergency`): emergency vehicles and emergency urgency only.
- **Status hues** (`positive`, `warning`, `destructive`): outcome text and dots (accepted, fallback/high urgency, rejected/failed, connection state).
- **Chart series** (`chart-ns`, `chart-ew`, `chart-fixed`, `chart-ai`, with `chart-grid` gridlines): darker steps of the identity hues for Recharts series, checked for separation against `card`. The fixed-time and AI controller series are a blue/orange pair that appears only in Metrics and Compare.

### Neutral
- **Dark Room** (`background`): page ground, header, the scene's clear colour.
- **Bench** (`card`): Home mode cards, agent cards, rail content cards.
- **Glass Slab** (`panel`, 94% opaque): every surface that floats over the scene (HUD, dock, view controls, connection banner) and the decision rail.
- **Raised Slab** (`popover`): popovers, select menus, chart tooltips, the transcript jump pill.
- **Fill steps** (`secondary`, `muted`, `accent`): hover fills, secondary buttons, the timeline row tracks (`muted` at 40%), the inline "finished" note.
- **Text steps** (`foreground`, `muted-foreground`, `subtle-foreground`): primary text; supporting text and inactive nav; captions, notes, axis ticks and "unavailable" values.
- **Hairline** (`border` at 10% white, `input` at 15%): every border and divider. `ring` provides the focus outline.
- **Scene materials** (`scene-*`): the diorama's base, asphalt, sidewalk, curb, markings, planting, foliage, buildings, signal housings and key light. These are the same neutral ramp with two muted greens and a warm lamp.

### Named Rules
**The Meaning-Only Rule.** Chrome is hue-255 grey. A colour that is not a neutral must name a signal state, a movement group, a participant (Agent A, Agent B, JEV, safety), an emergency, or an outcome. A colour that encodes nothing does not ship.

**The Signal Colours Mean Signals Rule.** `signal-red`, `signal-amber` and `signal-green` are used for signal state and for nothing else. They never indicate success, warning or error. Status has its own tokens.

**The Identity Pairing Rule.** Cyan always means North/South and Agent A. Violet always means East/West and Agent B. The pairing holds in the scene, the timeline, the charts (`chart-ns`, `chart-ew`), the cards and the Home diagram.

## Typography

**Display Font:** Overpass Variable (with ui-sans-serif, system-ui)
**Body Font:** Overpass Variable
**Label/Mono Font:** Overpass Mono Variable (with ui-monospace, SFMono-Regular)

**Character:** Overpass descends from US highway signage and was built to be read at a distance. That suits a projected demo, and it gives a whole product one plain, legible voice. Its mono sibling sets anything that ticks.

### Hierarchy
- **Wordmark** (640, 1.3125rem in the header, line-height 1, -0.02em): "Intersection" only. The same style is set larger in the intro and travels into the header slot.
- **Headline** (600, clamp(1.375rem, 2.2vw, 1.875rem), -0.015em, balanced): the single Home question above the preview.
- **Page title** (600, 2rem, -0.02em): Settings, About and Not Found headings.
- **Title** (600, 1.25rem, -0.01em): mode card titles. The HUD phase name uses 1.125rem at 600.
- **Title small** (600, 0.9375rem): agent and panel card headings.
- **Body large** (400, 0.9375rem, 1.625): mode card summaries, the Run button label.
- **Body** (400, 0.875rem): facts, nav, tabs, buttons, popover copy.
- **Body small** (400, 0.8125rem): the dense rail text, including agent status, rationale, decision rounds and notes. This is the workhorse size of the simulation view.
- **Label** (400–500, 0.75rem): stat labels, captions, figcaptions, verdict lines.
- **Micro** (500, 0.6875rem): provenance badges and rationale captions only.
- **Readout** (Overpass Mono, 0.75rem; 11px in SVG): the sim clock, N/S and E/W chips, timeline axis ticks and latency labels, model IDs.

### Named Rules
**The Readout Rule.** Use Overpass Mono for anything that is a clock, an identifier or a measured readout. Every number that updates in place also gets tabular figures (`.tabular`), so neighbours never shift.

**The One Family Rule.** One family sets everything, and weight and size carry the hierarchy (400, 500, 600, plus 640 for the wordmark). Body text never goes uppercase or letterspaced.

## Layout

The 3D scene is a single canvas staged behind the routes, and each page reserves a "stage" region for it. Panels are positioned around the stage or float over it; they never cover the intersection's centre.

- **Header:** fixed, `--header-height` 3.5rem, filled with `background` and no border. A three-column grid puts nav on the left, the wordmark in the centre and data-source status on the right. Below 640px it grows to 5.75rem and splits into two rows: wordmark and status on the first, nav centred on the second.
- **Home:** at 1280px and above (xl), a three-column grid (`minmax(18.5rem, 23rem) 1fr minmax(18.5rem, 23rem)`, 32px column gap) has the two mode cards flank the preview. They share one subgrid row, so both cards get the same height and top line, centred vertically. Between 768px and 1280px the cards sit side by side under the preview, and each card's Run button moves up to follow its summary so both actions land in the first viewport. Below 768px everything stacks, with the preview at 52vh.
- **Simulation (1024px and up):** the scene fills the left column. The decision rail sits on the right at `--rail-width` (clamp(22rem, 30vw, 30rem)) in `panel` with a left hairline. The signal HUD floats top-left, the view controls top-right, and the dock (control bar and timeline) is pinned to the bottom with 16px insets. Below 1280px the HUD keeps only its signal block, and the counts move to the Metrics tab.
- **Simulation (below 1024px):** the scene takes 58vh. The dock carries a one-line signal strip above the controls, the full HUD follows the dock, and the rail stacks below with a top hairline and a minimum height of 32rem.
- **Rhythm:** a 4px base. Expect 4/8/12px inside components, 12–16px between cards in the rail, 20px of mode-card padding, and 32px page gutters at xl (16px phone, 24px tablet).

## Elevation & Depth

Depth comes from tonal layering: `background` < `card` < `panel`/`popover`, with 10% white hairlines. At rest, chrome lying on the page is flat. Only surfaces that float above the scene (or above the Home preview) get a soft, downward, black ambient shadow with a strong negative spread. It reads as a slab casting onto the table, not as a lift effect. Shadows never glow or tint. The scene is where the real light lives: the key light, the cast shadows and the lit signal lamps.

### Shadow Vocabulary
- **Floating slab** (`box-shadow: 0 18px 40px -24px rgb(0 0 0 / 0.9)`): the dock and the Home mode cards (the cards use 0.8 alpha).
- **Floating slab, small** (`box-shadow: 0 16px 36px -20px rgb(0 0 0 / 0.9)`; view controls use `0 12px 28px -18px`): the signal HUD and the view-controls cluster.
- **Overlay** (Tailwind `shadow-md` plus a 1px `foreground/10` ring): popovers, select menus, chart tooltips, the transcript jump pill. The connection banner uses `shadow-lg`.

### Named Rules
**The Lit Model Rule.** No glow, gradient or coloured shadow appears on interface chrome. Emitted light belongs to the scene. Lamp halos on the 3D signal heads and the brake lights are the world's own light and stay.

## Shapes

Gently rounded and consistent. The base radius is `--radius` 0.5rem, with steps derived from it: controls, chips, nav links and diagram nodes use `md` (0.4rem); agent cards, the view-controls cluster and the banner use `lg` (0.5rem); the larger floating slabs and mode cards use `xl` (0.7rem). Anything that is a point, including status dots, identity dots, signal lamps, the bullet markers and provenance badges, is fully round. Timeline bars use 2px corners and their row tracks 3px, which keeps them chart-like rather than pill-like. Borders are always 1px hairlines. A dashed border signals something provisional: mock provenance, muted or discarded timeline bars, and the empty first decision round.

## Components

### Buttons
Familiar, quiet controls in which the white primary carries all the weight.
- **Shape:** gently rounded (`rounded.md`, 0.4rem). Default height is 36px; small is 32px; the Run button is 44px.
- **Primary:** `primary` fill with `primary-foreground` text, 500 weight. The Run button is full card width, with its label on the left and a trailing arrow icon on the right.
- **Hover / Focus:** primary fades to 80%. Focus shows the `ring` border plus a 3px ring at 50%; global `:focus-visible` is a 2px `ring` outline with 2px offset. Pressing nudges the button down 1px. Disabled is 50% opacity.
- **Secondary / Ghost:** secondary sits on `secondary` and lightens 5% toward foreground on hover. Ghost is transparent and fills with `muted` on hover. Destructive is a 10–20% tinted fill and is not used as a solid.

### Chips (signal chips and segmented controls)
- **Signal chip:** a hairline-bordered `md` capsule holding a 10px round lamp in the signal colour and a mono "N/S" or "E/W" label. Unknown state shows a `muted` lamp.
- **Segmented toggles** (speed, controller, camera view): a ToggleGroup with no spacing. The pressed item fills with `accent` and its text turns `foreground`.

### Cards / Containers
- **Corner Style:** `xl` for mode cards and floating slabs, `lg` for cards inside the rail.
- **Background:** `card` for content that lies on the page, `panel` for anything floating over the scene.
- **Shadow Strategy:** see Elevation. Only floating slabs and the mode cards carry shadows.
- **Border:** 1px `border` hairline everywhere. A selected mode card raises its border to `foreground/40`. Warning callouts use `warning/40` border on a `warning/10` fill.
- **Internal Padding:** 20px for mode cards, 16px for the HUD and rail tab bodies, 12px for agent cards and the dock.

### Inputs / Fields
- **Style:** Base UI select and switch primitives on an `input` hairline with an `md` radius and a transparent fill. Menus open on `popover`.
- **Focus:** the shared ring treatment described under Buttons.

### Navigation
- **Header nav:** 0.875rem text-only links, 32px tall, with `md` hover fill in `muted`. Inactive links use `muted-foreground` and the active link uses `foreground` with a 1px foreground underline. The centred wordmark is the home link.
- **Rail tabs:** line variant, 44px tall, with a bottom hairline under the list. The active tab shows a 2px foreground underline. The first tab is "Decisions" in AI mode and "Controller" in traditional mode.
- **Phones:** nav drops to a centred second header row, and the status label truncates.

### Provenance Badge (signature)
A 20px pill, 0.6875rem at 500 weight, with a tooltip explaining the source. **Mock** has a dashed `foreground/35` border with muted text. **Live** has a solid `foreground/60` border. **Rule-based** has a `safety` border and text. **Simulation** has a plain hairline with subtle text. It sits beside every piece of model output.

### Signal-Timing Timeline (signature)
A traffic-engineering signal-timing chart drawn in SVG on the simulation clock. The N/S and E/W light rows sit on top, with Agent A, Agent B, JEV and Safety lanes beneath. Rows are 18px with 4px gaps, a 74px label column, `muted/40` tracks, and a 1px foreground "now" line. Lane fills use the identity tokens at 90%. Pending bars sit at 55% and pulse (the pulse is off under reduced motion). Failed or rejected bars become a `destructive` outline. Discarded bars become a dashed `subtle-foreground` outline. Latency prints in mono on the bar when it fits. Projected fixed-time phases are drawn at 32% opacity. The Home fixed-cycle diagram is the static miniature of the same chart.

### Signal HUD
A `panel` slab (19rem) with the two signal chips, the session status and mono clock, the phase name, a countdown, a single controller/scenario/speed line, and a stat grid with identity dots. Between 1024px and 1280px it floats in compact form, signal block only. Below 1024px the dock shows the one-line Signal Strip, and the full HUD sits under the dock.

### Motion
Entrances use `cubic-bezier(0.16, 1, 0.3, 1)` over 0.6–0.7s with 6–40px of travel. Exits use `cubic-bezier(0.55, 0, 1, 0.45)` over 0.3–0.42s. The intro title travels to its header slot with `cubic-bezier(0.65, 0, 0.35, 1)` over 1.0s. When the visitor prefers reduced motion, travel distances become 0 and spinners and pulses stop.

## Do's and Don'ts

### Do:
- **Do** route every colour, including scene materials, through a token in `src/index.css`. The scene reads `--scene-*` and the semantic tokens at runtime.
- **Do** pair cyan with North/South and Agent A, and violet with East/West and Agent B, on every surface.
- **Do** set clocks, IDs and readouts in Overpass Mono, and give every live number tabular figures.
- **Do** put a provenance badge next to model output, and show null as "unavailable" or "—" in `subtle-foreground`, never as 0.
- **Do** use `panel` and the floating-slab shadow for anything over the scene, and `card` for anything lying on the page.
- **Do** keep a single filled `primary` action per region.

### Don't:
- **Don't** use signal red, amber or green for success, warning or error. Use `positive`, `warning` and `destructive`.
- **Don't** add glow, gradients or coloured shadows to interface chrome. The scene's lamp halos are the only emitted light.
- **Don't** introduce a hue that encodes nothing, or a second type family.
- **Don't** cover the intersection's centre with a panel, and don't let a panel outweigh the scene.
- **Don't** uppercase or letterspace UI labels.
