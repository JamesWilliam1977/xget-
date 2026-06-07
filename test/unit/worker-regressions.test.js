import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../../src/index.js';

/** @type {ExecutionContext} */
const executionContext = {
  waitUntil() {},
  passThroughOnException() {}
};

describe('Worker regression coverage', () => {
  /** @type {{ match: ReturnType<typeof vi.fn>, put: ReturnType<typeof vi.fn> }} */
  let cacheDefault;

  beforeEach(() => {
    cacheDefault = {
      match: vi.fn(async () => null),
      put: vi.fn(async () => undefined)
    };

    vi.stubGlobal('caches', {
      default: cacheDefault
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not leak thrown upstream error details to clients', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('secret-upstream-detail'));

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      { MAX_RETRIES: '1', RETRY_DELAY_MS: '0', TIMEOUT_SECONDS: '1' },
      executionContext
    );

    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).not.toContain('secret-upstream-detail');
    expect(body).not.toContain('Failed after');
  });

  it('clears timeout handles when upstream fetch rejects', async () => {
    const timeoutToken = { id: 'timeout-token' };
    const setTimeoutSpy = vi.fn(() => timeoutToken);
    const clearTimeoutSpy = vi.fn();

    vi.stubGlobal('setTimeout', setTimeoutSpy);
    vi.stubGlobal('clearTimeout', clearTimeoutSpy);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      { MAX_RETRIES: '1', RETRY_DELAY_MS: '0', TIMEOUT_SECONDS: '5' },
      executionContext
    );

    expect(response.status).toBe(502);
    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutToken);
  });

  it('does not cache host-bound PyPI rewritten HTML responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<a href="https://files.pythonhosted.org/packages/demo.whl">demo</a>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    );

    const response = await worker.fetch(
      new Request('https://mirror.example/pypi/simple/demo/'),
      {},
      executionContext
    );

    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('https://mirror.example/pypi/files/packages/demo.whl');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(cacheDefault.put).not.toHaveBeenCalled();
  });

  it('forwards body and content type for configured non-protocol POST requests', async () => {
    /** @type {{ url: string, method: string | undefined, body: string | null, contentType: string | null, cf: unknown }} */
    let observed = {
      url: '',
      method: undefined,
      body: null,
      contentType: null,
      cf: undefined
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      observed = {
        url: String(input),
        method: init?.method,
        body: init?.body ? await new Response(init.body).text() : null,
        contentType: new Headers(init?.headers).get('Content-Type'),
        cf: /** @type {RequestInit & { cf?: unknown }} */ (init || {}).cf
      };

      return new Response('created', {
        status: 201,
        headers: { 'Content-Type': 'text/plain' }
      });
    });

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'test' })
      }),
      { ALLOWED_METHODS: 'GET,HEAD,POST' },
      executionContext
    );

    expect(response.status).toBe(201);
    expect(observed).toEqual({
      url: 'https://github.com/user/repo/issues',
      method: 'POST',
      body: JSON.stringify({ title: 'test' }),
      contentType: 'application/json',
      cf: undefined
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cacheDefault.match).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns Docker registry version metadata for /v2/ probes', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v2/'),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Docker-Distribution-Api-Version')).toBe('registry/2.0');
    expect(response.headers.get('X-Performance-Metrics')).toBeNull();
    expect(await response.text()).toBe('{}');
  });

  it('redirects unknown platforms and bare platform prefixes to the homepage', async () => {
    const unknownPlatform = await worker.fetch(
      new Request('https://example.com/not-a-platform/resource'),
      {},
      executionContext
    );
    const barePlatform = await worker.fetch(
      new Request('https://example.com/gh/', { method: 'GET' }),
      {},
      executionContext
    );

    expect(unknownPlatform.status).toBe(302);
    expect(unknownPlatform.headers.get('Location')).toBe('https://github.com/xixu-me/Xget');
    expect(barePlatform.status).toBe(302);
    expect(barePlatform.headers.get('Location')).toBe('https://github.com/xixu-me/Xget');
  });

  it('rejects Docker requests that do not use a /cr/ prefix', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v2/library/nginx/manifests/latest'),
      {},
      executionContext
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('/cr/ prefix');
  });

  it('rejects disallowed CORS preflight methods before proxying upstream', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST'
        }
      }),
      { ALLOWED_ORIGINS: 'https://app.example.com' },
      executionContext
    );

    expect(response.status).toBe(405);
    expect(await response.text()).toBe('Method not allowed');
  });

  it('serves cached responses without proxying upstream', async () => {
    cacheDefault.match.mockResolvedValueOnce(
      new Response('cached-body', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('should-not-run', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      {},
      executionContext
    );
    const metrics = JSON.parse(response.headers.get('X-Performance-Metrics') || '{}');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('cached-body');
    expect(metrics).toHaveProperty('cache_hit');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reuses cached full content for range requests when a ranged entry is absent', async () => {
    cacheDefault.match.mockResolvedValueOnce(null).mockResolvedValueOnce(
      new Response('full-body', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('should-not-run', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt', {
        headers: { Range: 'bytes=0-3' }
      }),
      {},
      executionContext
    );
    const metrics = JSON.parse(response.headers.get('X-Performance-Metrics') || '{}');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('full-body');
    expect(metrics).toHaveProperty('cache_hit_full_content');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to upstream fetch when cache lookup throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cacheDefault.match.mockRejectedValueOnce(new Error('cache-down'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Cache API unavailable:', expect.any(Error));
  });

  it('configures Git passthrough headers for upload-pack requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-upload-pack-result' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo.git/git-upload-pack', {
        method: 'POST'
      }),
      {},
      executionContext
    );
    const upstreamHeaders = new Headers(fetchSpy.mock.calls[0][1]?.headers);

    expect(response.status).toBe(200);
    expect(upstreamHeaders.get('User-Agent')).toBe('git/2.34.1');
    expect(upstreamHeaders.get('Content-Type')).toBe('application/x-git-upload-pack-request');
  });

  it('derives HEAD content length from a range probe when the upstream omits it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      expect(new Headers(init?.headers).get('Range')).toBe('bytes=0-0');
      return new Response(null, {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-0/123' }
      });
    });

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt', { method: 'HEAD' }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('123');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('uses a successful GET probe to recover missing HEAD content length', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': '321' }
      });
    });

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt', { method: 'HEAD' }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('321');
  });

  it('wraps upstream client errors in detailed JSON responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('teapot', {
        status: 418,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      { MAX_RETRIES: '1', RETRY_DELAY_MS: '0' },
      executionContext
    );
    const body = await response.json();

    expect(response.status).toBe(418);
    expect(body.error).toContain('Upstream server error (418): teapot');
  });

  it('retries upstream 5xx responses before succeeding', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('busy', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        })
      )
      .mockResolvedValueOnce(
        new Response('ok', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        })
      );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      { MAX_RETRIES: '2', RETRY_DELAY_MS: '0' },
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries rejected upstream fetches before succeeding', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('temporary-network-failure'))
      .mockResolvedValueOnce(
        new Response('ok', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        })
      );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      { MAX_RETRIES: '2', RETRY_DELAY_MS: '0' },
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('times out requests when the abort timer fires', async () => {
    const timeoutToken = { id: 'abort-timeout' };
    const clearTimeoutSpy = vi.fn();

    vi.stubGlobal(
      'setTimeout',
      vi.fn((callback, delay) => {
        void delay;
        callback();
        return timeoutToken;
      })
    );
    vi.stubGlobal('clearTimeout', clearTimeoutSpy);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.signal?.aborted) {
        const error = new Error(`Aborted before fetching ${String(input)}`);
        error.name = 'AbortError';
        throw error;
      }

      return new Response('unexpected-success', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    });

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      { MAX_RETRIES: '2', RETRY_DELAY_MS: '0', TIMEOUT_SECONDS: '1' },
      executionContext
    );

    expect(response.status).toBe(408);
    expect(await response.text()).toBe('Request timeout');
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutToken);
  });

  it('falls back to default retries when retry configuration is invalid', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      { MAX_RETRIES: '-1' },
      executionContext
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('logs and recovers when request setup throws unexpectedly', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const redirectSpy = vi.spyOn(Response, 'redirect').mockImplementation(() => {
      throw new Error('boom');
    });

    const response = await worker.fetch(new Request('https://example.com/'), {}, executionContext);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(errorSpy).toHaveBeenCalledWith('Error handling request:', expect.any(Error));
    expect(redirectSpy).toHaveBeenCalled();
  });

  it('retries Docker requests with an anonymous token and follows redirects on success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      if (url === 'https://ghcr.io/v2/private/repo/manifests/latest') {
        if (!headers.has('Authorization')) {
          return new Response('', {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"'
            }
          });
        }

        expect(headers.get('Authorization')).toBe('Bearer token-123');
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://pkg.example.com/manifest' }
        });
      }

      if (url.startsWith('https://ghcr.io/token')) {
        return new Response(JSON.stringify({ token: 'token-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url === 'https://pkg.example.com/manifest') {
        expect(headers.get('Authorization')).toBeNull();
        return new Response('', {
          status: 200,
          headers: { 'Content-Length': '0' }
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const response = await worker.fetch(
      new Request('https://example.com/cr/ghcr/v2/private/repo/manifests/latest', {
        headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('warns and falls back to a Docker auth challenge when token negotiation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="https://ghcr.io/token"' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/cr/ghcr/v2/private/repo/manifests/latest', {
        headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(
      'Bearer realm="https://example.com/cr/ghcr/v2/auth",service="Xget"'
    );
    expect(warnSpy).toHaveBeenCalledWith('Token fetch failed:', expect.any(Error));
  });

  it('returns a ranged response after caching the full upstream body', async () => {
    cacheDefault.match
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        new Response('xy', {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-1/6' }
        })
      );

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('xyz123', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.bin', {
        headers: { Range: 'bytes=0-1' }
      }),
      {},
      executionContext
    );
    const metrics = JSON.parse(response.headers.get('X-Performance-Metrics') || '{}');

    expect(response.status).toBe(206);
    expect(metrics).toHaveProperty('range_cache_hit_after_full_cache');
  });

  it('warns when cache writes fail without waitUntil support', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cacheDefault.put.mockRejectedValueOnce(new Error('cache-put-down'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('cached', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      {},
      /** @type {ExecutionContext} */ ({})
    );

    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith('Cache put failed:', expect.any(Error));
  });

  it('warns when post-store cache lookups fail for range requests', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cacheDefault.match
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('range-cache-down'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('abcdef', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.bin', {
        headers: { Range: 'bytes=0-1' }
      }),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith('Cache put/match failed:', expect.any(Error));
  });

  it('copies upstream content length from non-standard header objects when needed', async () => {
    const upstreamHeaders = {
      /**
       * Reads an upstream header value.
       * @param {string} name
       */
      get(name) {
        const header = name.toLowerCase();
        if (header === 'content-type') {
          return 'text/plain';
        }
        if (header === 'content-length') {
          return '777';
        }
        return null;
      },
      *[Symbol.iterator]() {
        yield ['Content-Type', 'text/plain'];
      }
    };

    const fakeResponse = /** @type {Response} */ ({
      body: null,
      headers: upstreamHeaders,
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok'
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse);

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('777');
  });

  it('warns when upstream content length cannot be read during response finalization', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstreamHeaders = {
      /**
       * Reads an upstream header value.
       * @param {string} name
       */
      get(name) {
        if (name.toLowerCase() === 'content-type') {
          return 'text/plain';
        }

        throw new Error('content-length unavailable');
      },
      *[Symbol.iterator]() {
        yield ['Content-Type', 'text/plain'];
      }
    };

    const fakeResponse = /** @type {Response} */ ({
      body: null,
      headers: upstreamHeaders,
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok'
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse);

    const response = await worker.fetch(
      new Request('https://example.com/gh/user/repo/file.txt'),
      {},
      executionContext
    );

    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith('Could not set Content-Length header:', expect.any(Error));
  });
});
