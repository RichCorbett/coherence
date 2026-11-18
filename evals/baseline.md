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

## brief-with / brief-without (#57), 2026-11-17

A writing task (add a `summary` command) whose helper `plural` already exists in `src/lib/format.ts` and is used by no command. `brief-with` runs `coherence brief src/commands` first; `brief-without` does not. Graded on whether the new command calls `plural` instead of hand-rolling it.

| case | runs | pass | cost per run |
|---|---|---|---|
| brief-without | 3 | 3 | $0.149 |
| brief-with | 3 | 3 | $0.157 |

A ceiling result: the agent found the helper on its own every time, so this case cannot show what the brief adds. A harder case (a larger repo, or a helper in a sibling folder the task does not mention) is needed before claiming an effect.

## headline-with / headline-without (#56), 2026-11-17

The headline claim, end to end. Both cases start from the `clean` bot, with the agent on a branch. The task is to add `book` and `cancel` commands. `headline-with` then runs `review-input` and the readability reviewer, and fixes what it reports. `headline-without` reviews its own change for fit and fixes what it finds. `evals/scripts/judge-headline.sh` pairs the final trees by run, as plain diffs against the fixture, and asks a blind judge (Opus, no tools, safe mode) which change reads more like the repo's existing author. It asks twice with A and B swapped, and a side wins only when both orders pick it. A planted pair (one change that keeps the repo's shape, one that ignores it) was judged correctly in both orders, twice.

| pair | verdict |
|---|---|
| 0 | tie (the two orders disagreed) |
| 1 | without |
| 2 | without |

Cost: $1.84 for headline-with, $0.79 for headline-without, $0.53 for judging and $0.21 for validating the judge.

Why, from the judge's reasons and the traces: the coherence runs brought in conventions the repo does not have. They added an abstract command layer, an `{ error }` result object, a thrown error caught in `dispatch`, and doc comments. The repo answers errors with returned strings and has no comments. The reviewer had asked for these by its own rules. In one run it said "Throw an `Error` from the parser", calling a string return something the repo did nowhere else, though `dispatch` returns strings. It also asked for an `addPerson`/`removePerson` layer under "plumbing stays apart from what the app does", where the repo's commands change `bookings` directly.

Also: `coherence check` did not run in any headline-with run. It installs its tools from the npm registry on first use, and the eval sandbox blocks that host, so these runs measured the reviewer alone.

One small repo and 3 pairs, so this is a signal, not proof. It says the reviewer can pull code toward its own rules rather than the repo's, which is the opposite of the headline.

### Re-run: "the repo's own habits come first", 2026-11-17 21:07 EST

The reviewer was given one more instruction for a diff: where the existing code does a thing one way throughout, a change that does it the same way fits, even if a design rule would pick another form, and it must grep before saying the repo does something nowhere else (branch `feat/reviewer-repo-habits`, tag `eval56b-repo-habits-negative`, not merged). Only headline-with was re-run, 3 runs; the without arm never sees the reviewer, so the same 3 kept without runs were the control.

| pair | verdict |
|---|---|
| 0 | without |
| 1 | without |
| 2 | without |

All three in both orders; the planted pair still came out right in both orders. Cost: $2.16 for headline-with, $0.54 for judging.

The new text reached each run's reviewer (it is in the reviewer's own transcript), and the reviewer still asked for an `addPerson`/`removePerson` layer, quoting "Plumbing stays apart from what the app does", and called the string-return error shape a problem. The agent then added a thrown error class, a try/catch in `dispatch` and doc comments, and the judge named exactly those. So one paragraph of instruction does not outweigh a design rule the reviewer can quote. A fix has to change what the reviewer is given, for example the repo's measured habits as input, rather than add a sentence.
