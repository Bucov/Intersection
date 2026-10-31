---
name: Intersection
description: One live 3D intersection, two controllers on either side of it, every decision drawn in coloured squares.
colors:
  background: "oklch(0.2 0.003 75)"
  foreground: "oklch(0.93 0.011 80)"
  card: "oklch(0.232 0.004 75)"
  popover: "oklch(0.255 0.005 75)"
  panel: "oklch(0.212 0.004 75 / 0.95)"
  primary: "oklch(0.93 0.011 80)"
  primary-foreground: "oklch(0.2 0.003 75)"
  secondary: "oklch(0.27 0.005 75)"
  muted: "oklch(0.262 0.005 75)"
  accent: "oklch(0.3 0.006 75)"
  muted-foreground: "oklch(0.75 0.009 80)"
  subtle-foreground: "oklch(0.63 0.008 80)"
  border: "oklch(0.93 0.011 80 / 11%)"
  input: "oklch(0.93 0.011 80 / 18%)"
  ring: "oklch(0.93 0.011 80 / 85%)"
  cell: "oklch(0.93 0.011 80 / 7%)"
  signal-red: "oklch(0.64 0.215 27)"
  signal-amber: "oklch(0.81 0.16 78)"
  signal-green: "oklch(0.75 0.19 148)"
  group-ns: "oklch(0.76 0.13 222)"
  group-ew: "oklch(0.68 0.19 302)"
  jev: "oklch(0.9 0.075 95)"
  safety: "oklch(0.74 0.04 245)"
  emergency: "oklch(0.68 0.21 10)"
  positive: "oklch(0.78 0.14 160)"
  warning: "oklch(0.82 0.14 75)"
  destructive: "oklch(0.68 0.2 27)"
  chart-ns: "#00a4c0"
  chart-ew: "#8048b6"
  chart-fixed: "#3987e5"
  chart-ai: "#d95926"
  scene-base: "oklch(0.235 0.004 75)"
  scene-asphalt: "oklch(0.29 0.004 75)"
  scene-sidewalk: "oklch(0.41 0.006 75)"
  scene-curb: "oklch(0.5 0.006 75)"
  scene-marking: "oklch(0.92 0.012 85)"
  scene-planting: "oklch(0.35 0.04 135)"
  scene-foliage: "oklch(0.46 0.07 138)"
  scene-building: "oklch(0.33 0.005 75)"
  scene-signal-housing: "oklch(0.22 0.004 75)"
  scene-key-light: "oklch(0.99 0.015 80)"
typography:
  wordmark-intro:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(52px, 13vw, 208px)"
    fontWeight: 640
    lineHeight: 1
    letterSpacing: "-0.035em"
  wordmark:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 640
    lineHeight: 1
    letterSpacing: "-0.035em"
  display:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)"
    fontWeight: 620
    lineHeight: 0.95
    letterSpacing: "-0.045em"
  nav:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 1.3vw, 1.25rem)"
    fontWeight: 450
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  action:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 560
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  title-sm:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  body-sm:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.375
  label:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  readout:
    fontFamily: "Onest Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    fontFeature: "\"tnum\""
rounded:
  none: "0px"
spacing:
  square-gap: "3px"
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
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.none}"
    height: "36px"
  mode-action:
    textColor: "{colors.foreground}"
    typography: "{typography.action}"
  nav-link:
    textColor: "{colors.foreground}"
    typography: "{typography.nav}"
    height: "36px"
  square-mark:
    size: "7px"
    rounded: "{rounded.none}"
  legend-square:
    size: "9px"
    rounded: "{rounded.none}"
  timeline-cell:
    backgroundColor: "{colors.cell}"
    size: "up to 12px"
    rounded: "{rounded.none}"
  panel-floating:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.none}"
    padding: "16px"
---

# Design System: Intersection

## Overview

**Creative North Star: "Both Sides of the Junction"**

A warm charcoal room with one live scale model of an intersection in the middle of it. The two ways of running that intersection stand on either side of the model like the two camps of a data essay, each drawn as a column of small coloured squares that spells out its mechanism. Type sits directly on the ground: a wide, tight grotesk in warm off-white, lowercase in the navigation and the wordmark, with no bars, cards or pills around it. Colour lives only in squares, and every square means one thing.

The interface borrows two references and keeps them apart. The chrome takes its palette, type and lowercase restraint from a dark grotesk portfolio header: charcoal ground, off-white words spread across the top, nothing boxed. The data takes its form from a unit-chart essay: crisp squares in a few saturated colours, two millimetres apart, one square per unit. The 3D scene stays the brightest, most detailed thing on screen; the opening sequence earns that by showing one car alone before the world appears around it.

Density is moderate. Home is airy and presenter-friendly; the simulation is denser so it reads at laptop distance. Every visual decision is a token in `src/index.css`, and the 3D scene reads its `--scene-*` and semantic colours at runtime.

**Key Characteristics:**
- Warm charcoal room (hue 75, near-zero chroma) and warm off-white type; the scene's lamp is the only light.
- One family, Onest, from the poster-scale intro wordmark down to tabular readouts.
- Squares, not dots: crisp, unrounded, 7 to 12px, 2 to 3px apart, each a single meaning.
- No containers on the ground: titles, legends and links sit directly on the room. Only surfaces that float over the scene get a slab.
- Square corners everywhere (`--radius: 0`).
- Provenance (mock, live, rule-based, simulation) is always visible next to model output, as a square and a word.

## Colors

A warm neutral ramp around one charcoal, plus the small set of saturated meaning colours that only ever appear as squares, lights in the scene and chart series.

### Primary
- **Warm Off-White** (`primary` / `foreground`, oklch(0.93 0.011 80)): all primary text, the wordmark, the one filled control per region (Play/Pause) with charcoal text on it, the playhead, the "live" square.

### Secondary
- **Signal Red / Amber / Green** (`signal-red`, `signal-amber`, `signal-green`): signal state only. Lamp squares in the HUD, the signal rows of the timeline and session strip, the fixed-cycle unit chart, the fixed-time legend on Home, the 3D signal heads and stop-line strips.
- **North/South Cyan** (`group-ns`): the North/South group and Agent A, wherever either appears.
- **East/West Violet** (`group-ew`): the East/West group and Agent B.

### Tertiary
- **JEV Straw** (`jev`): JEV, the arbitration model: its square, its timeline row, its chosen-probability unit bar.
- **Safety Steel** (`safety`): the deterministic safety gate and the rule-based provenance square.
- **Emergency Rose** (`emergency`): emergency vehicles and emergency urgency only.
- **Status hues** (`positive`, `warning`, `destructive`): outcomes, connection state and confidence bands.
- **Chart series** (`chart-ns`, `chart-ew`, `chart-fixed`, `chart-ai`): Recharts lines in Metrics and Compare.

### Neutral
- **Charcoal Room** (`background`, oklch(0.2 0.003 75)): page ground, the scene's clear colour and fog, the intro's mask. Pre-painted as `#171615` in `index.html`.
- **Bench** (`card`) and **Raised Slab** (`popover`): the decision round's box, select menus, tooltips.
- **Floating Slab** (`panel`, 95%): the HUD, the dock, the view controls and the decision rail.
- **Fill steps** (`secondary`, `muted`, `accent`): secondary buttons, hover fills, pressed toggles.
- **Text steps** (`foreground`, `muted-foreground`, `subtle-foreground`): text, supporting text, captions and axis labels.
- **Empty Cell** (`cell`, off-white at 7%): an empty square of a unit chart; the grid stays visible where nothing happened.
- **Hairline** (`border` 11%, `input` 18%): every divider and slab edge.

### Named Rules
**The Square Means One Thing Rule.** A coloured square names a signal state, a participant, a status or a provenance. A square that encodes nothing does not ship, and nothing else in the chrome carries hue.

**The Signal Colours Mean Signals Rule.** Red, amber and green are signal state only; outcomes use `positive`, `warning` and `destructive`.

**The Identity Pairing Rule.** Cyan is North/South and Agent A; violet is East/West and Agent B, in the scene, the timeline, the legends and the charts.

## Typography

**Display Font:** Onest Variable (with ui-sans-serif, system-ui)
**Body Font:** Onest Variable
**Readout Font:** Onest Variable with tabular figures (`.font-mono` and `.tabular` both set `tabular-nums`)

**Character:** A wide grotesk with round dots and flat-topped t's, set tight. At poster scale it is the intro's wordmark; at 1rem in lowercase it is quiet navigation; with tabular figures it is every clock and readout.

### Hierarchy
- **Wordmark, intro** (640, clamp(52px, 13vw, 208px), -0.035em, lowercase "intersection"): the opening poster; the same element travels into the header.
- **Wordmark** (640, 1.0625rem, -0.035em, lowercase): the centred home button in the header.
- **Display** (620, clamp(2.25rem, 3.4vw, 3.25rem), 0.95, -0.045em): the two controller titles on Home, "traditional" and "AI".
- **Nav** (450, 1rem, -0.01em, lowercase): header links and the data-source status.
- **Headline** (450, clamp(1.0625rem, 1.3vw, 1.25rem)): the single Home question.
- **Action** (560, 1.125rem, -0.02em): "Run traditional →" and "Run AI →".
- **Title small** (600, 0.9375rem): rail headings and agent names.
- **Body / Body small** (400, 0.875rem / 0.8125rem): legends, rail text, decision rounds.
- **Label / Readout** (400, 0.75rem; 11px in SVG): stat labels, axis ticks, latencies, clocks, always tabular.

### Named Rules
**The One Family Rule.** Onest sets everything; weight, size and case carry hierarchy. There is no monospace face.

**The Lowercase Chrome Rule.** The wordmark and header links are lowercase. Proper names and acronyms inside them keep their case ("by MAGI", "AI"); body copy uses sentence case.

## Layout

The 3D scene is one canvas behind every route. Each page reserves an empty "stage" element whose rect becomes the camera's insets.

- **Header:** transparent, fixed, 3.75rem. Five equal columns at 640px and up: "compare" left-aligned, "settings" centred in column two, the wordmark at the exact centre, "about" centred in column four, the data source right-aligned. Below 640px it is 5.75rem: wordmark centred and status right on the first row, the three links centred on the second. Page content starts below the header (`top: var(--header-height)`), so nothing scrolls under it.
- **Home (xl, 1280px+):** three columns (`minmax(17rem, 23rem) 1fr minmax(17rem, 23rem)`). The traditional block stands left, right-aligned, its squares on its right edge; the AI block stands right, left-aligned, its squares on its left edge; both share a top line. A radial falloff (`ellipse 36% 48% at 50% 53%`) lets the roads fade into the room before they reach the text.
- **Home (md to xl):** the preview on top, the two blocks beneath it, still mirrored around the page's centre line. A room-coloured layer behind the blocks fades in over 4rem from the caption, so the text sits on clean ground rather than on the scene's unlit edge.
- **Home (phones):** stacked, both blocks left-aligned with squares on the left.
- **Simulation (lg+):** scene left, rail right (`clamp(22rem, 30vw, 30rem)`), HUD top-left, view controls top-right, the dock (controls, timeline, session strip) pinned to the bottom with 16px insets.
- **Square rhythm:** squares are spaced 2 to 3px apart; a unit-chart row pitch is 12 to 16px. Elsewhere a 4px base: 8 to 12px inside groups, 16 to 20px between them.

## Elevation & Depth

Flat. Depth comes from the scene's own light and from tonal steps: `background` < `panel` < `card` < `popover`. Slabs that float over the scene carry a hairline border and no shadow. The only shadows are on overlays that pop over content (menus, tooltips, the connection banner, the transcript's jump button).

### Named Rules
**The Lamp Is the Only Light Rule.** No glow, gradient or coloured shadow on chrome. The one gradient is the Home room falloff, which is the room's own colour fading in, not decoration.

## Shapes

Square corners throughout (`--radius: 0`): buttons, toggles, selects, slabs and every mark. Round shapes are reserved for primitives that need them (switch, radio). Squares are the shape language: 7px for inline markers, 9px for legends and unit bars, up to 12px for timeline cells. A hollow square (1.5px outline) means "not real" or "not yet": mock provenance, a waiting decision step, a failed or discarded timeline cell. Borders are 1px hairlines; a dashed border marks something provisional.

## Components

### Header
Plain lowercase words on the room. The current page shows a 6px off-white square before its label; hovering another link shows the square at 40%. The wordmark is the home link; during the intro it is invisible until the travelling title lands on it.

### Controller blocks (Home)
A display title, a one-line summary, a legend column of 9px squares (the fixed cycle phase by phase, then three hollow squares for the cycle repeating, or the AI pipeline Agent A → Agent B → JEV → safety → light), one or two lines of fact, and the action. The whole block is the hit area. Hover underlines the action, nudges its arrow and runs a dimming wave down the squares (`legend-run`, 0.9s, 55ms stagger). Starting blinks the squares.

### Square mark
`Square`: a 7 to 10px square in a meaning colour, solid or hollow, optionally blinking (`square-blink`, 1.1s). Replaces every status dot, identity dot and provenance pill. Provenance reads as square plus word: hollow "Mock", solid off-white "Live", steel "Rule-based", subtle "Simulation".

### Buttons and toggles
Square-cornered shadcn/Base UI primitives. Play/Pause is the one filled off-white button; secondary and outline toggles sit on `secondary` and `input` hairlines.

### Signal HUD
A `panel` slab: two signal lamps as squares with "N/S" and "E/W", status and tabular clock, phase name, countdown (or "Replaying m:ss of m:ss"), and a stat grid whose queue labels carry the group squares.

### Signal-timing unit chart (signature)
The coordination drawn as squares on the simulation clock: N/S and E/W light rows, then Agent A, Agent B, JEV and Safety. One square per step (100 ms to 10 s, the finest that keeps a 12px pitch), empty steps as `cell` squares. Pending squares blink, failed are destructive outlines, discarded are subtle outlines. Ahead of the live edge only the fixed schedule is drawn, at 28%; after a replayed moment, what followed is drawn at 42%. A right-hand column prints each lane's latest latency. While paused, dragging the grid moves the playhead.

### Session strip and rewind (signature)
The whole scenario as two rows of small squares (N/S, E/W light), a 2px off-white playhead and a faint live-edge marker. It is a slider: while paused, drag it or use ← → (Shift for 5 s), Home and End. Replay is drawn from recorded snapshots: the scene, the HUD and the decision rail all show the replayed moment; resuming returns to live. The status line says which: "Live ⋅ pause to rewind" with a blinking square, or "Replaying m:ss ⋅ the simulation is paused at m:ss" with "Back to m:ss".

### Unit bars
Probabilities and progress as rows of 9px squares: JEV's choice distribution and confidence (20 squares, 5% each, thresholds as hairline ticks), the comparison's progress (24 squares), and decision sources as one square per accepted decision (or per n when there are many).

### Opening sequence (signature)
"intersection" at poster scale and "by MAGI" on the empty room. One car drives up the northbound lane through a soft hole in the room-coloured mask that follows it; the camera cranes up behind it. The car breaks through the byline (letters pushed aside, blurred, faded) while the title lifts into the header slot. As the car nears the far side of the junction the mask opens outward from it, the fleet fades in, the camera pulls back to the Home framing and the page appears. Any key or click skips. Reduced motion, no WebGL or a scene that is not ready within 2.5s fall back to the title travelling over a fading room.

### Motion
Entrances use `cubic-bezier(0.16, 1, 0.3, 1)` over 0.6 to 0.8s. Exits use `cubic-bezier(0.55, 0, 1, 0.45)` over 0.3 to 0.42s. The intro title travels with `cubic-bezier(0.55, 0, 0.15, 1)` over 1.05s. Reduced motion removes travel, waves and blinking.

## Do's and Don'ts

### Do:
- **Do** draw status, identity and provenance as squares, never dots or pills.
- **Do** keep text on the ground; give a surface a slab only when it floats over the scene.
- **Do** set every clock, latency and live number with tabular figures.
- **Do** pair cyan with North/South and Agent A, violet with East/West and Agent B, everywhere.
- **Do** label replay as replay and mock as mock; show null as "—" or "unavailable", never 0.
- **Do** route every colour, scene materials included, through a token in `src/index.css`.

### Don't:
- **Don't** round corners or use a status dot.
- **Don't** use signal red, amber or green for success, warning or error.
- **Don't** add a hue that encodes nothing, or a second type family.
- **Don't** box Home's titles and legends in cards.
- **Don't** cover the intersection's centre with a panel or let a panel outweigh the scene.
- **Don't** present a replayed moment as the live simulation, or claim the authoritative simulation was rewound.
