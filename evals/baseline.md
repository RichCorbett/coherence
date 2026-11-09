# Eval baseline

Compare any change to the reviewer or the taste file against this. Recorded 2026-11-09 with Claude Code 2.1.319,
`coherence:readability-reviewer` on Opus at medium effort, three runs per case, Sonnet judges.

| Case | Result |
|------|--------|
| reinvented | 9 of 9 grader passes |
| overbuilt | 9 of 9 grader passes |
| no-shape | 9 of 9 grader passes |
| clean (control) | stated the idea 3 of 3; raised no significant problem 2 of 3 |

The one control miss said the bot had no way to run it, which is true of this small fixture but is not a coherence defect.

After the taste file moved from examples to ideas, the three planted cases stayed at 9 of 9 and the control's "no significant problem" went to 1 of 3. Both misses were verdicts of "coherent" that still listed small nits, so the reviewer's weak spot is over-reporting on clean code.

These fixtures are tiny, so this shows the reviewer can spot each kind of defect, not that it holds up across a large repo.
