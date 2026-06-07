import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

describe('Package manifest', () => {
  it('does not depend on itself', () => {
    const require = createRequire(import.meta.url);
    const packageJson = require('../../package.json');
    const typedPackageJson =
      /** @type {{ dependencies?: Record<string, string>, name: string }} */ (packageJson);

    expect(typedPackageJson.name).toBe('xget');
    expect(typedPackageJson.dependencies?.xget).toBeUndefined();
  });
});
