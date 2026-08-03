---
name: dependency-update-via-dependabot
description: Workflow command scaffold for dependency-update-via-dependabot in xget-.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /dependency-update-via-dependabot

Use this workflow when working on **dependency-update-via-dependabot** in `xget-`.

## Goal

Automated update of npm dependencies, often grouped by type (e.g., cloudflare-dev, linting, etc.), including both direct and indirect dependencies.

## Common Files

- `package.json`
- `package-lock.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Dependabot creates a commit updating package.json and/or package-lock.json with new dependency versions.
- A pull request is opened for the update.
- The pull request is merged, resulting in a merge commit.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.