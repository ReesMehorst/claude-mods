---
name: theme-builder
description: Build a theme mod for the Claude desktop and mobile apps from a mood, a place, a palette or an image someone describes. Picks light and dark colors, checks contrast until Desktop will paint it, and can add a backdrop, a message style, a sound, and live reactions to the session (moving while Claude works, speeding up as the context fills, cooling when the prompt cache goes cold). Use when someone asks to make, design, build, tweak or share their own theme, color scheme, look or skin for Claude.
---

# Theme builder

Turns an idea ("a rainy Tokyo night", "solarized but warmer", "my brand's teal") into a
theme mod: a small plugin that calls `$.theme.set` when a session starts. Only the desktop
and mobile apps draw themes; the terminal and editors keep their own colors, so say so when
someone is in a terminal.

`SKILL_DIR` below is the folder this file is in. It holds two mods to copy, `template/` (a
still theme: colors, plus any extras) and `template-live/` (a theme that reacts to the session,
with a scene, sound and tests), and `scripts/check-theme.mjs` (the palette checker).

## 1. Load the engine's own guide first

Invoke the built-in `plugin-authoring` skill before writing anything. It is the source of
truth for this build and tells you:

- the folder to write mods in (its *WHERE TO WRITE IT*), which hot-reloads the mod when the
  turn ends once the person allows it;
- the path of `look.md`, the full theme guide. **Read it.** This skill only adds a workflow on top;
  where they differ, `look.md` wins;
- where `make-colors.js` and `make-colors.d.ts` are. Always copy them fresh from there, never from
  an older theme: an old copy paints wrong colors on a newer app.

## 2. Find the idea (one round of questions at most)

If the person already gave a mood, place, image or colors, skip straight to step 3 and propose.
Otherwise ask once, with `AskUserQuestion`, only what you can't pick yourself:

- **Inspiration**: a place, era, material, artwork style or a few hex colors.
- **Modes**: both light and dark (the default), or one only (a night scene, a paper look).
- **Extras**, multi-select, all optional: a still backdrop (color or gradient), a moving
  scene, message style (bubble shapes, fonts, tilt), ambient sound.
- **React to the session**, multi-select, all optional. It shows in a moving scene, so picking
  any reaction brings one:
  - *Move while Claude works*: the scene moves during a turn and rests while Claude waits.
  - *Faster as the context fills*: faster at 35%, 60% and 80% context, with a warning color
    from 80% (time to compact).
  - *Cool down when the cache goes cold*: a cue in the prompt cache's last minute, then a still,
    cooled scene and app colors once it lapses, until the next message.
  - *Sound follows the session*: rests, rises with the context, falls quiet when cold.

  Each reaction is a switch in the mod's settings. The picked ones default to on, the others to
  off (`"default": false` in `userConfig`), so the person can still turn them on later.

Name the mod in kebab-case after the idea (`tide-pool`, `lamp-lit-paper`), and give it a short
`label` for people to see.

Take the spirit of a place or era, never a company's logo, artwork, font or a copy of another
product's theme by name. A person's own brand colors are fine.

## 3. Pick the palette

Write the anchors and roles yourself, following `look.md`'s *What good looks like*:

- **Tinted grays**: every surface drawn from the theme's hue. In **both** modes `surface-0` is
  the darkest and each later surface is as light or lighter; neighbors a few percent of
  lightness apart. In light mode `surface-2` and `surface-3` match if you give both.
- **Text first**: `text-primary` at 7:1 or better on every surface, `text-secondary` and
  `text-muted` at 4.5:1 on `surface-0` and `surface-2`.
- **Keep meaning**: `danger` a red, `success` a green, `warning` an amber, nudged toward the
  theme's hue. `accent` and `pro` carry the theme's character. Code is colored from these five,
  so keep them apart in hue.
- **Dark is its own version** of the idea (lamp-lit paper, not inverted paper). Keep dark
  `surface-3` close to `surface-0`: a light one is the usual reason Desktop refuses a theme.

Optional: `git` colors inside a mode, `codeTheme`, `contrast: 'more'`, `only: 'light' | 'dark'`
for a single-mode theme (all in `look.md`).

## 4. Scaffold the mod

In the mods folder from step 1, create `<mod-name>/` from `SKILL_DIR/template-live/` when any
reaction was picked, else from `SKILL_DIR/template/`. **The folder name, `plugin.json`'s `name`
and every `__MOD_NAME__` must be the same string**: the engine names the mod after its folder,
and a mismatch makes every state write fail.

1. Copy the template's files (`.claude-plugin/plugin.json`, `hooks/`, and `types/` for the live
   one) into the mod folder.
2. Copy `make-colors.js` and `make-colors.d.ts` from the plugin-authoring folder into
   `<mod>/hooks/`, untouched.
3. Fill every placeholder (search the mod for `__[A-Z_]*__`): `__MOD_NAME__`, `__DESCRIPTION__`,
   `__LABEL__`, and in the live template `__SCENE_ALT__` (what the scene shows, for screen
   readers). Then write the palette in `PALETTE`.

`template/`'s `register.ts` sets the colors at `session.start`, toasts the line that would stop
Desktop painting, and falls back to the colors alone if a build refuses `EXTRAS` (style or
sound). Keep `PALETTE` a plain literal: the checker reads it from the file's text.

`template-live/` splits the work:

- `hooks/mood.ts` reads the session into a `Mood` (`isMoving`, `gear` 0 to 3, `cache` none, warm,
  soon or cold) and holds switched-off reactions at their calm value. Leave it as it is.
- `hooks/art.ts` is the theme's own: `sceneSvg(mood)` and `soundFor(mood, follows)`. Its default
  (soft drifting lights) works; replace it with the theme's idea, keeping the signatures and the
  meanings listed at its top.
- `hooks/register.tsx` holds `PALETTE` and `COLD_PALETTE` (the same theme with its grays cooled,
  shown while the cache is cold; it may spread `PALETTE`), `STYLE`, and the hooks. It sets the
  theme again only when the colors or sound must change; the scene redraws from the mood by itself.
- In `plugin.json`, set `"default": false` on each reaction not picked, and reword the titles and
  descriptions for the theme ("ride" for a road, "drift" for the sea).
- `hooks/theme.test.ts` checks both palettes paint, the scene and sound differ by mood, and a
  session moves, rests, cools and warms again. Keep it passing as you change the art.

## 5. Check, then fix until it paints

```
node SKILL_DIR/scripts/check-theme.mjs <mod folder> --html <scratchpad>/<mod-name>-swatches.html
```

It runs the mod's own `makeColors` on `PALETTE` (and `COLD_PALETTE` in a live theme), prints a
contrast table per mode, then:

- `BLOCKER`: Desktop ignores the **whole** theme. Fix every one (exit code 1 until you do).
- `AIM`: under this skill's bars from step 3, or surfaces out of order. Fix these too.
- notes (`--all` lists them): under the design system's own bar but still painted. Stop here;
  an empty list isn't the goal and the app's own colors don't reach it.

Show the person the swatch page (a file in the scratchpad, sent with `SendUserFile`) so they can
react to the colors before the mod loads. Adjust and rerun as they ask.

## 6. Extras (only what was asked)

Put each into `EXTRAS` in `register.ts`, or for a backdrop into `BASE` (it is as old as colors).
`look.md` has the rules; the types file named by plugin-authoring has every range
(`ThemeBackdrop`, `ThemeStyle`, `ThemeSound`).

- **Still backdrop**: `backdrop: { color }`, `{ gradient }` or `{ vector }`; palette names such as
  `surface-0` follow the mode. Give message and tool rows a nearly solid `backgroundColor` over it.
- **Moving scene**: `backdrop: { scene: '<name>' }` plus a `ui.render` hook on
  `{ component: 'Backdrop' }` returning an `Svg` (rename the module to `register.tsx` and update
  `hooks.json`; the checker reads either). Keep the SVG string in `hooks/scene.js`
  (`export const SCENE = "..."`) with a `scene.d.ts` beside it (`export const SCENE: string`),
  imported as `./scene.js`: a `.ts` import path fails `tsc`. Generate the SVG with a small script
  rather than by hand, and switch its colors with `@media (prefers-color-scheme: light)`. Pure vector, under 131,072 characters, slow CSS motion, `viewBox` with
  `preserveAspectRatio="xMidYMid slice"`, subject away from the middle and the foot, a finished
  look with animation removed.
- **Message style**: `style: { Text, Heading, UserMessage, AssistantMessage, ToolUse }`. Lengths
  are points (`lineHeight: 24`, never `1.5`), `fontFamily` one generic name, `rotate` within ±3.
- **Reactions** (live template): draw each mood in `art.ts`. At rest it is fully still, each
  gear is visibly faster, gear 3 uses the theme's warning color, `soon` is a small cue on the
  focal point, and `cold` is still and cooled. Keep motion slow even in gear 3, and nothing
  flashing: a pulse slower than once a second. To react to something more, follow `mood.ts`:
  keep it in the `mood` atom the `Backdrop` render reads, and declare functions that take `$` at
  the top of the module, never inside `register` (the engine refuses them there). Each `atom(...)`
  spells the mod's name as a string literal.
- **Sound**: `sound: { ambience, cues }`, quiet and sparse. Tests play none, so ask the person
  to press the speaker in the title bar and listen.

## 7. Verify and load

Run in the mod folder, and fix what they report:

- `claude plugin validate <mod folder>`: README and LICENSE warnings only matter for a directory
  submission.
- `tsc -p <mod folder>` once the engine has laid the types (or plugin-authoring's fallback
  tsconfig before the first load).
- `claude plugin test <mod folder>` for a live theme.

Then it loads when the turn ends (hot-reload on) or with `claude --plugin-dir <mod folder>`.
`$.theme.set`'s `isDrawn: false` shows its `reason` in the status line. A wrong color name paints
nothing and says nothing, which is why the palette goes through `makeColors` only.

Ask the person to look in **both modes**, with a long code block on screen and at a larger
text size. For a live theme, tell them how to see each reaction: send a message and watch the
scene move, and leave the session idle past the cache's lifetime (5 minutes, or an hour on the
1-hour cache) to see it cool. Then tweak from there ("warmer", "less contrast in dark", "make accent teal").
Rerun step 5 after each change.

## 8. Share (offer once, after they've seen it work)

Follow plugin-authoring's *Sharing a mod*: ask public or private before creating anything, scan
for secrets, add a README with a screenshot of each mode. When the person keeps their mods in a
marketplace repo (a `.claude-plugin/marketplace.json` in the working folder), offer to add the
theme there instead: copy the mod folder in, add an entry with `"category": "theme"` (or the
repo's own convention), and a README section with its install line.
