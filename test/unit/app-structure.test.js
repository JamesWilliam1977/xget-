import { afterEach, describe, expect, it, vi } from 'vitest';

import apiHandler, { config as vercelConfig } from '../../adapters/functions/api/index.js';
import { handler as denoHandler } from '../../adapters/functions/deno.js';
import { onRequest } from '../../adapters/pages/functions/[[path]].js';
import { createRequestContext } from '../../src/app/request-context.js';
import { PLATFORM_CATALOG } from '../../src/config/platform-catalog.js';
import { normalizeEffectivePath, resolveTarget } from '../../src/routing/resolve-target.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Mocks the upstream fetch used by adapter smoke tests.
 * @returns {ReturnType<typeof vi.spyOn>} Fetch spy.
 */
function mockUpstreamFetch() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('adapter-ok', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    })
  );
}

describe('Application structure', () => {
  it('builds a shared request context for protocol-aware routing', () => {
    const request = new Request('https://example.com/ip/openai/v1/chat/completions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });

    const context = createRequestContext(request, {
      ALLOWED_METHODS: 'GET,HEAD,POST'
    });

    expect(context.isAI).toBe(true);
    expect(context.isCorsPreflight).toBe(true);
    expect(context.config.SECURITY.ALLOWED_METHODS).toContain('POST');
  });

  it('normalizes Docker host-style paths before resolving upstream targets', () => {
    const url = new URL('https://example.com/v2/cr/ghcr/xixu-me/xget/manifests/latest');
    const normalized = normalizeEffectivePath(url, true);

    expect('effectivePath' in normalized).toBe(true);
    if ('effectivePath' in normalized) {
      expect(normalized.effectivePath).toBe('/cr/ghcr/v2/xixu-me/xget/manifests/latest');

      const target = resolveTarget(url, normalized.effectivePath, PLATFORM_CATALOG);
      expect('response' in target).toBe(false);
      if (!('response' in target)) {
        expect(target.platform).toBe('cr-ghcr');
        expect(target.targetUrl).toBe('https://ghcr.io/v2/xixu-me/xget/manifests/latest');
      }
    }
  });

  it('exposes thin runtime adapter entrypoints', () => {
    expect(typeof apiHandler).toBe('function');
    expect(typeof denoHandler).toBe('function');
    expect(typeof onRequest).toBe('function');
    expect(vercelConfig).toEqual({ runtime: 'edge' });
  });

  it('delegates Cloudflare Pages requests through the shared handler with env overrides', async () => {
    const fetchSpy = mockUpstreamFetch();
    const waitUntil = vi.fn();

    const response = await onRequest({
      request: new Request('https://pages.example.com/gh/user/repo/pages-file.txt'),
      env: { CACHE_DURATION: '42' },
      params: {},
      waitUntil,
      next: async () => new Response('next'),
      data: {}
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/user/repo/pages-file.txt',
      expect.objectContaining({ method: 'GET' })
    );
    expect(await response.text()).toBe('adapter-ok');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=42');
  });

  it('delegates Netlify/Vercel function requests through the shared handler with env overrides', async () => {
    const fetchSpy = mockUpstreamFetch();

    const response = await apiHandler(
      new Request('https://functions.example.com/gh/user/repo/functions-file.txt'),
      {
        env: { CACHE_DURATION: '43' },
        geo: {},
        waitUntil: vi.fn()
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/user/repo/functions-file.txt',
      expect.objectContaining({ method: 'GET' })
    );
    expect(await response.text()).toBe('adapter-ok');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=43');
  });

  it('delegates Deno requests through the shared handler with env overrides', async () => {
    const fetchSpy = mockUpstreamFetch();
    vi.stubGlobal('Deno', {
      env: {
        get: vi.fn(name => (name === 'CACHE_DURATION' ? '44' : undefined))
      }
    });

    const response = await denoHandler(
      new Request('https://deno.example.com/gh/user/repo/deno-file.txt')
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/user/repo/deno-file.txt',
      expect.objectContaining({ method: 'GET' })
    );
    expect(await response.text()).toBe('adapter-ok');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=44');
  });
});
