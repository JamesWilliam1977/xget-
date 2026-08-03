---
name: ci-workflow-update
description: Workflow command scaffold for ci-workflow-update in xget-.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /ci-workflow-update

Use this workflow when working on **ci-workflow-update** in `xget-`.

## Goal

Updates to GitHub Actions workflow files, especially for Dependabot auto-merge or CI triggers.

## Common Files

- `.github/workflows/dependabot-auto-merge.yml`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit .github/workflows/dependabot-auto-merge.yml or similar workflow files.
- Commit the changes with a ci-related message.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.