---
name: report-open
description: Use when finishing work that produces a report, summary, analysis, hand-off note, or any markdown document meant for the user to read — open it rendered in a desktop reader (Typora by default) with the bundled report-open script, instead of printing it in the terminal or suggesting a TTY reader (glow, bat, frogmouth). macOS only.
---

# report-open

The user reads documents in a real editor, not in the terminal. Terminal
renderers stay monospace, and the typographic hierarchy is the point — colors
are not enough.

## Use it

```bash
~/.claude/skills/report-open/report-open <file>
```

Opens the file and places its window in the right-hand quarter of the screen,
full height. Writes nothing.

| Variable | Default | Meaning |
| --- | --- | --- |
| `REPORT_APP` | `Typora` | reader application |
| `REPORT_SIDE` | `right` | `right`, `left`, or `full` |
| `REPORT_FRACTION` | `0.25` | share of screen width |
| `REPORT_BOUNDS` | — | `"left, top, right, bottom"`, overrides side and fraction |

```bash
REPORT_SIDE=left REPORT_FRACTION=0.33 ~/.claude/skills/report-open/report-open note.md
REPORT_APP="Obsidian" ~/.claude/skills/report-open/report-open note.md
```

Screen size is read at runtime, so the placement follows whatever display is
attached. macOS clamps the vertical edges itself for the menu bar and the Dock.

`REPORT_BOUNDS` takes the four **edges**, not position and size.

## When to reach for it

After producing any markdown the user is meant to read: a report at the end of a
task, an analysis, a comparison, a hand-off. Write the file first, then run the
script and tell the user it is open.

Skip it for throwaway output the user only needs as terminal text.

## If it fails

The script retries for 5 seconds while the app starts, then exits non-zero. A
reader that does not expose its windows to AppleScript will always fail that
way — the file still opens, only the placement is lost.

It drives the app through direct Apple Events (`tell application "…" to set
bounds of window 1`), which needs no Accessibility permission. Do not rewrite it
to use `System Events` — that path requires Accessibility, and on macOS the
permission belongs to the application that owns the process tree, which for an
agent's commands is the agent, not the user's terminal.
