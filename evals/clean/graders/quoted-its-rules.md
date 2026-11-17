---
type: llm
---
Every finding in the reviewer's report should end with a **Rule:** line: either the words of a design rule or taste line in double quotes, or one of `correctness`, `security`, `steering`.
PASS if every listed finding has such a Rule line (a report with no findings passes).
FAIL if any finding lacks one.
