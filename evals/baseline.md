# Eval baseline

## taste-applied after #43 option A, 2026-11-13

The case gained a second taste line, "Don't flag a lib module importing a command", and `src/lib/format.ts` now imports `ListCommand`, against the direction the fixture's ARCHITECTURE.md states and in a cycle with `list.ts`. The reviewer prompt now says taste reaches style and shape only, never correctness or a technical design rule. Only this case was run, 1 or 3 runs at a time, about $4.45 in all.

| Prompt | still-found-the-backwards-import | honored-the-rejection | still-found-the-duplicate |
|---|---|---|---|
| before (main) | 2/4 | 2/4 | 4/4 |
| after, final wording | 3/3 | 1/3 | 3/3 |
| after, three earlier wordings | 8/9 | 3/9 | 9/9 |

- The grader discriminates weakly: the old reviewer often raises the import anyway, as a doc the code contradicts. Once it said "I'm not flagging the import direction, per your preference", which is the failure this case guards.
- honored-the-rejection fell from 3/3 on the old one-line fixture to about half on this one, with the old prompt too. The reviewer drops the hand-written clone but says this call of it is redundant before `JSON.stringify`. That leak comes with the fixture change, not the new wording; it is not fixed.

## Latest run: reviewer on Sonnet, 2026-11-09

Not rerun since the reviewer lost Bash: its taste, rules and diff now arrive in its prompt, and the five reviewer cases ask the main session to paste taste and rules in. Treat the numbers below as the baseline to compare against.

The fixture ARCHITECTURE.md and README.md files have also changed since: they no longer state that commands extend `BaseCommand` and dispatch by name, which the `stated-the-idea` and `kept-the-good-shape` graders look for. Rerun every case before comparing.

3 runs per case, $4.12, Claude Code 2.1.321, `coherence:readability-reviewer` on Sonnet at medium effort, Sonnet judges.

| Case | Grader | Passed |
|---|---|---|
| clean | found-no-defect | 3/3 |
| clean | stated-the-idea | 3/3 |
| no-shape | found-inconsistent-shapes | 3/3 |
| no-shape | found-overlapping-names | 3/3 |
| no-shape | found-ticket-named-file | 3/3 |
| overbuilt | found-overbuilt | 3/3 |
| overbuilt | said-how-small | 3/3 |
| overbuilt | kept-the-good-shape | 2/3 |
| reinvented | found-duplicate-helper | 3/3 |
| reinvented | found-standard-library | 3/3 |
| reinvented | kept-the-good-shape | 2/3 |
| taste-capture | used-the-skill | 3/3 |
| taste-capture | recorded-a-general-line | 3/3 |
| taste-one-off | stayed-quiet | 3/3 |
| taste-applied | still-found-the-duplicate | 3/3 |
| taste-applied | honored-the-rejection | 0/3, then 3/3 after the fix below |

In honored-the-rejection the reviewer loaded the preference and then raised the same code from a different angle. The rule added to its report step, to drop every finding about something a preference says not to flag, fixed that in a rerun of that one case, 3 runs for $0.62. The other cases have not been rerun with that rule.

## Previous run: reviewer on Opus

3 runs per case, about $6 in all, on the final reviewer and taste skill.

| Case | Grader | Passed |
|---|---|---|
| clean | found-no-defect | 3/3 |
| clean | stated-the-idea | 3/3 |
| no-shape | found-inconsistent-shapes | 3/3 |
| no-shape | found-overlapping-names | 3/3 |
| no-shape | found-ticket-named-file | 3/3 |
| overbuilt | found-overbuilt | 3/3 |
| overbuilt | said-how-small | 3/3 |
| overbuilt | kept-the-good-shape | 2/3 |
| reinvented | found-duplicate-helper | 3/3 |
| reinvented | found-standard-library | 3/3 |
| reinvented | kept-the-good-shape | 2/3 |
| taste-capture | used-the-skill | 3/3 |
| taste-capture | recorded-a-general-line | 3/3 |
| taste-one-off | stayed-quiet | 3/3 |
| taste-applied | still-found-the-duplicate | 3/3 |
| taste-applied | honored-the-rejection | 2/3 |

## History

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

The taste cases, 3 runs each: the skill fired and recorded a new preference 3 of 3, stayed quiet on a one-off change 3 of 3, and declined to duplicate a preference already in the style. A preference in the log was honored 2 of 3, and the miss declined to suggest the standard library but still questioned the clone, while the other defect was found 3 of 3. These ran before the log moved from accepted/rejected to plain preferences, and the rerun was cut off by a usage limit.

After plain preferences, the cross-file instructions and the merge call, 3 runs each: clean 3/3 on both graders, no-shape 9/9, taste-capture 6/6, taste-one-off 3/3, overbuilt 8/9, reinvented 8/9 and taste-applied 5/6. All three misses are on "kept the good shape" or "honored the preference".

These fixtures are tiny, so this shows the reviewer can spot each kind of defect, not that it holds up across a large repo.
