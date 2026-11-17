#!/bin/bash
# Judges the headline cases blind (#56): usage judge-headline.sh <with-dir>... -- <without-dir>...
# Each dir is a run's final working tree (a kept eval run's sealed/home/cwd). No git runs in them, because the agent under test
# could have written their git config: a change is a plain diff of the tree against the clean fixture both cases start from.
# Each with-run is paired with the without-run at the same position. A judge sees the repo as it was at the start and the two changes
# as code diffs only, labelled A and B, with no commit messages and nothing that names the tool. Each pair is judged twice with
# A and B swapped, and a side wins only when both orders pick it, so the order the changes are shown in cannot decide.
set -euo pipefail
with=(); without=(); side=with
for arg in "$@"; do
  if [ "$arg" = "--" ]; then side=without; elif [ $side = with ]; then with+=("$arg"); else without+=("$arg"); fi
done
[ ${#with[@]} -eq ${#without[@]} ] && [ ${#with[@]} -gt 0 ] || { echo "usage: $0 <with-dir>... -- <without-dir>... (as many of each)" >&2; exit 2; }

fixture="$(cd "$(dirname "$0")/../clean/fixtures/repo" && pwd -P)"

change() { # the run's tree against the fixture, with both folder names stripped so nothing in a path tells the arms apart
  # diff follows symbolic links, so a link the agent left could put any file on this machine into the judge's prompt: a tree
  # holding anything but plain files and folders is refused.
  [ -d "$1" ] || { echo "judge-headline: no run tree at $1" >&2; exit 2; }
  set -- "$(cd "$1" && pwd -P)" # one spelling of the folder, so the header lines below always match it
  if [ -n "$(find "$1" \( -name .git -o -name .coherence-bin \) -prune -o ! -type f ! -type d -print -quit)" ]; then
    echo "judge-headline: $1 holds a link or special file; refusing to read it" >&2; exit 2
  fi
  local out status=0
  out=$(diff -ruN -x .git -x .coherence-bin "$fixture" "$1") || status=$?
  # 1 means the trees differ; anything above it means diff could not read them, and a partial change must not be judged.
  [ "$status" -le 1 ] || { echo "judge-headline: diff failed on $1" >&2; exit 2; }
  # Only the header lines, and diff's line for a changed binary file, name the folders; code lines are left exactly as written.
  python3 -I -c '
import sys
fixture, run = sys.argv[1] + "/", sys.argv[2] + "/"
for line in sys.stdin.read().splitlines():
    if line.startswith(("diff ", "--- ", "+++ ", "Binary files ")):
        line = line.split("\t", 1)[0].replace(fixture, "a/").replace(run, "b/")
    print(line)
' "$fixture" "$1" <<<"$out"
}

judge() { # change-A change-B -> the judge's JSON reply: A, B or tie, then the reason
  local prompt
  prompt="You are judging two changes to the same small TypeScript repo. Both implement the same request: add \`book\` and \`cancel\` commands.
Judge only one thing: which change reads more as if the repo's existing author wrote it. Look at reuse of what the repo already has, the shape commands already take, where code is placed, naming, and how errors are answered. Ignore which one is shorter, and ignore correctness unless it is plainly broken.

=== THE REPO BEFORE EITHER CHANGE ===
$(cd "$fixture" && find . -type f | sort | while read -r file; do printf -- '--- %s\n' "${file#./}"; cat "$file"; done)

=== CHANGE A ===
$1

=== CHANGE B ===
$2

Answer with exactly one first line, A, B or tie, then one paragraph saying why."
  claude -p --safe-mode --model opus --output-format json --tools "" <<<"$prompt"
}

for i in "${!with[@]}"; do
  w=$(change "${with[$i]}") && o=$(change "${without[$i]}") || exit 2
  first=$(judge "$w" "$o"); second=$(judge "$o" "$w")
  python3 -I - "$i" "$first" "$second" <<'EOF'
import json, sys
i, first, second = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
def pick(reply, a_is):
    # Anything but A, B or tie is a failed judgment, not a tie: it stops the run rather than count.
    answer = reply["result"].strip().split("\n", 1)[0].strip().strip("*").upper()
    if reply.get("is_error") or answer not in ("A", "B", "TIE"):
        sys.exit(f"judge-headline: pair {i} got no verdict: {reply['result'][:200]!r}")
    return {"A": a_is, "B": "without" if a_is == "with" else "with", "TIE": "tie"}[answer]
p1, p2 = pick(first, "with"), pick(second, "without")
verdict = p1 if p1 == p2 else "tie"
cost = first.get("total_cost_usd", 0) + second.get("total_cost_usd", 0)
print(json.dumps({"pair": int(i), "with_shown_first": p1, "without_shown_first": p2, "verdict": verdict, "costUsd": round(cost, 4),
                  "reason_first": first["result"], "reason_second": second["result"]}))
EOF
done
