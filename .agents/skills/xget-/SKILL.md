```markdown
# xget- Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development practices, coding conventions, and collaborative workflows used in the `xget-` JavaScript repository. You will learn how to structure code, manage dependencies, update documentation, maintain CI workflows, and contribute features or bugfixes with proper testing and documentation. The guide also provides actionable commands for common tasks.

## Coding Conventions

- **Language:** JavaScript (no framework)
- **File Naming:** Use kebab-case for all files.
  - Example: `my-module.js`, `utils/helper-functions.js`
- **Import Style:** Use relative imports.
  ```js
  // Good
  import { myFunc } from './my-func.js';
  // Bad
  import { myFunc } from 'my-func';
  ```
- **Export Style:** Use named exports.
  ```js
  // Good
  export function doSomething() { ... }
  export { doSomethingElse };
  // Bad
  export default function() { ... }
  ```
- **Commit Messages:** Freeform, but often prefixed with `deps`, `chore`, `fix`, `ci`, or `docs`.
  - Example: `fix: handle edge case in xget-parse`
  - Average length: ~64 characters

## Workflows

### Dependency Update via Dependabot
**Trigger:** When a new version of a dependency is released and Dependabot detects it  
**Command:** `/update-dependency`

1. Dependabot creates a commit updating `package.json` and/or `package-lock.json` with new dependency versions.
2. A pull request is opened for the update.
3. Review and merge the pull request.

**Files involved:**  
- `package.json`
- `package-lock.json`

---

### Readme Multilingual Update
**Trigger:** When documentation needs to be updated or improved across all supported languages  
**Command:** `/update-readme-all`

1. Edit `README.md`, `README.zh-Hans.md`, and `README.zh-Hant.md` with the desired changes.
2. Commit the changes with a `docs:`-prefixed message.
   ```sh
   git add README.md README.zh-Hans.md README.zh-Hant.md
   git commit -m "docs: update all readme translations for new usage"
   git push
   ```

**Files involved:**  
- `README.md`
- `README.zh-Hans.md`
- `README.zh-Hant.md`

---

### CI Workflow Update
**Trigger:** When CI/CD automation needs to be changed (e.g., to support new auto-merge behavior or update action versions)  
**Command:** `/update-ci-workflow`

1. Edit `.github/workflows/dependabot-auto-merge.yml` or similar workflow files.
2. Commit the changes with a `ci:`-prefixed message.
   ```sh
   git add .github/workflows/dependabot-auto-merge.yml
   git commit -m "ci: update dependabot auto-merge action version"
   git push
   ```

**Files involved:**  
- `.github/workflows/dependabot-auto-merge.yml`

---

### Feature or Bugfix with Tests and Docs
**Trigger:** When developing a new feature or fixing a bug that requires code, test, and documentation changes  
**Command:** `/feature-with-tests`

1. Edit or add source code files in `src/`.
2. Edit or add test files in `test/`.
3. Edit README files if documentation is needed.
4. Commit all related changes together.
   ```sh
   git add src/my-feature.js test/my-feature.test.js README.md
   git commit -m "feat: add my-feature with tests and docs"
   git push
   ```

**Files involved:**  
- `src/**/*.js`
- `test/**/*.js`
- `README.md`
- `README.zh-Hans.md`
- `README.zh-Hant.md`

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test File Pattern:** All test files are named `*.test.js` and typically reside in a `test/` directory.
- **Example Test:**
  ```js
  // test/my-feature.test.js
  import { describe, it, expect } from 'vitest';
  import { myFeature } from '../src/my-feature.js';

  describe('myFeature', () => {
    it('should return expected result', () => {
      expect(myFeature('input')).toBe('output');
    });
  });
  ```

## Commands

| Command                | Purpose                                                          |
|------------------------|------------------------------------------------------------------|
| /update-dependency     | Trigger a dependency update via Dependabot                       |
| /update-readme-all     | Update all README files (main and translations)                  |
| /update-ci-workflow    | Update CI/CD workflow files (e.g., for Dependabot auto-merge)    |
| /feature-with-tests    | Add a feature or bugfix with tests and documentation             |
```