---
name: readme-multilingual-update
description: Workflow command scaffold for readme-multilingual-update in xget-.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /readme-multilingual-update

Use this workflow when working on **readme-multilingual-update** in `xget-`.

## Goal

Synchronized updates to all README files (main and translations) to refine, align, or clarify documentation.

## Common Files

- `README.md`
- `README.zh-Hans.md`
- `README.zh-Hant.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit README.md, README.zh-Hans.md, and README.zh-Hant.md with the desired changes.
- Commit the changes with a docs-related message.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.