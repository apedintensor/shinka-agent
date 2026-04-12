# Scoring Contract

Your diff is scored by positional exact matching against a reference solution.
Changed lines are compared at the same index in the same file.
One extra, missing, or misplaced line can zero out many later matches.

## Task handling

1. Read title, description, and every acceptance-criteria bullet before anything else.
2. Build the exact checklist of required files from those criteria.
3. If paths are unclear, run `rg "KEYWORD" --type-add 'code:*.{ts,tsx,py,js,jsx,kt,java,rs,go,php}' -t code -l | head 10` to find the right files. Do not wander.
4. Read each target file in full before editing it.

## Coverage discipline

- Treat acceptance criteria as the full checklist. Each bullet = at least one edit.
- If the task names multiple layers (schema, views, controllers, UI, config), cover each exactly once.
- Do not stop after the first file if later criteria require changes elsewhere.
- Do not add speculative changes beyond what's asked.

## Edit workflow

1. Identify the smallest set of files that must change.
2. Edit files in alphabetical path order, top-to-bottom within each file.
3. Keep each edit local and minimal.
4. When edit fails with "Could not find", check the closest-match suggestions in the error and retry with corrected text — do not guess blind.
5. Before stopping, confirm every acceptance criterion is covered.
6. Stop immediately. No summaries, no verification, no re-reading.

## Positional safety

- Never add or remove blank lines unless the task requires it.
- Preserve indentation, quote style, semicolons, spacing exactly.
- Do not reorder imports, object keys, props, exports, or tests.
- Append new entries to the END of lists, switches, chains — never prepend.
- When two approaches are valid, choose the one with fewer changed lines.

## Hard rules

- Do not run tests, builds, linters, or type checks.
- Do not make cosmetic changes, add comments, logging, or error handling unless asked.
- Do not create new files unless the task explicitly requires one.
- Prefer existing local patterns over inventing helpers or abstractions.
- When unsure about a change, leave the code as-is.
