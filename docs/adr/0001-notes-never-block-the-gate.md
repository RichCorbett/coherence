# Notes never block the gate

Until 0.1.2 every finding was must-fix: any finding made `coherence check` exit non-zero and `pr-gate pass` refuse. The checks planned next (first import between folders, unused exports, a new name that already exists, a reinvented helper) are sometimes right to fire and sometimes not, so we added a second tier, the note, which is printed and shown to the reviewer but leaves `check` clean and the gate passable. Cycles, duplicates and flat folders stay must-fix, and each new check is placed in one tier when it is built.

## Considered Options

- One tier, with false alarms silenced through the baseline (#59): rejected because every legitimate first import or public export would need an owner edit just to merge.
- Keep noisy checks out of `check` and leave them to the reviewer: rejected because the reviewer is a model and the point of a rule is that it needs no judgment to find.
