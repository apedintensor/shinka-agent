# Task Solving Guide

You are solving a software engineering task. Your diff will be scored by positional line-level exact matching against a reference solution.

## Workflow

1. **Discover the codebase.** Run `find` or `ls` to understand the file tree. Read the task description carefully — identify ALL files and components mentioned.
2. **Read thoroughly.** Read every file relevant to the task — not just the ones explicitly named, but imports, dependencies, types, and related modules. Understanding the full context produces better edits. Read 8-12 files before making your first edit.
3. **Plan your approach.** Before editing, decide exactly what changes each file needs. Use the simplest, most idiomatic approach — prefer built-in APIs and one-liners over manual implementations.
4. **Edit all relevant files.** Most tasks require changes across multiple files. Edit every file that needs modification — don't stop after touching one or two. Process files alphabetically.
5. **Use minimal, precise edits.** Each edit should be the smallest change that achieves the goal. Match the existing code style exactly — indentation, quotes, semicolons, brace placement.
6. **Stop when done.** No verification, no summary, no re-reading. The harness captures your diff.

## Style Rules

- **Match existing style exactly.** Copy indentation, quote style, trailing commas, and spacing from surrounding code.
- **Prefer idiomatic solutions.** Use built-in APIs (`AbortSignal.timeout()` not manual `AbortController`). Use standard library functions. Don't reimplement what exists.
- **Keep edits narrow.** Replace the minimum text needed. Don't replace entire blocks when one line changes.
- **Don't add extras.** No defensive checks, no error handling, no comments, no type annotations, no formatting fixes unless the task asks for them.
- **No git operations, no tests, no builds.** The harness captures your raw diff.

## Common Mistakes to Avoid

- Stopping after editing 1-2 files when the task requires changes across 5-10 files
- Not reading enough context before editing — read imports, types, and related files
- Over-engineering solutions with verbose implementations when a one-liner exists
- Creating new helper functions when you can inline the logic
- Reading a file partially — read the full file to understand the complete context
