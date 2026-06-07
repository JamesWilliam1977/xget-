import { describe, expect, it } from 'vitest';

import { createConfig } from '../../src/config/index.js';
import { isGitLFSRequest, isGitRequest } from '../../src/protocols/git.js';
import {
  addCorsHeaders,
  addSecurityHeaders,
  createErrorResponse,
  resolveAllowedOrigin
} from '../../src/utils/security.js';
import { getAllowedMethods, isDockerRequest, validateRequest } from '../../src/utils/validation.js';

describe('Utility Functions', () => {
  describe('createConfig', () => {
    it.each([
      ['-1', 300],
      ['0', 300],
      ['abc', 300],
      ['60', 60]
    ])('should parse CACHE_DURATION=%s as %i', (value, expected) => {
      expect(createConfig({ CACHE_DURATION: value }).CACHE_DURATION).toBe(expected);
    });

    it('should reject invalid numeric runtime overrides', () => {
      const config = createConfig({
        MAX_PATH_LENGTH: '-1',
        MAX_RETRIES: '-2',
        RETRY_DELAY_MS: '-10',
        TIMEOUT_SECONDS: '0'
      });

      expect(config.MAX_RETRIES).toBe(3);
      expect(config.RETRY_DELAY_MS).toBe(1000);
      expect(config.TIMEOUT_SECONDS).toBe(30);
      expect(config.SECURITY.MAX_PATH_LENGTH).toBe(2048);
    });

    it('should allow zero retry delay for tests and low-latency deployments', () => {
      expect(createConfig({ RETRY_DELAY_MS: '0' }).RETRY_DELAY_MS).toBe(0);
      expect(createConfig({ RETRY_DELAY_MS: 0 }).RETRY_DELAY_MS).toBe(0);
    });

    it.each([
      { label: 'empty string', value: '' },
      { label: 'blank string', value: ' ' },
      { label: 'tab string', value: '\t' },
      { label: 'null', value: null },
      { label: 'false', value: false },
      { label: 'empty array', value: [] }
    ])('should reject zero-coercible RETRY_DELAY_MS from $label', ({ value }) => {
      expect(createConfig({ RETRY_DELAY_MS: value }).RETRY_DELAY_MS).toBe(1000);
    });

    it.each([
      { label: 'empty string', value: '' },
      { label: 'blank string', value: ' ' },
      { label: 'tab string', value: '\t' },
      { label: 'null', value: null },
      { label: 'false', value: false },
      { label: 'empty array', value: [] }
    ])('should reject zero-coercible positive integer overrides from $label', ({ value }) => {
      const config = createConfig({
        CACHE_DURATION: value,
        MAX_PATH_LENGTH: value,
        MAX_RETRIES: value,
        TIMEOUT_SECONDS: value
      });

      expect(config.CACHE_DURATION).toBe(300);
      expect(config.MAX_RETRIES).toBe(3);
      expect(config.SECURITY.MAX_PATH_LENGTH).toBe(2048);
      expect(config.TIMEOUT_SECONDS).toBe(30);
    });

    it.each([
      { label: 'true', value: true },
      { label: 'date object', value: new Date(0) }
    ])('should reject non-string non-number runtime overrides from $label', ({ value }) => {
      const config = createConfig({
        CACHE_DURATION: value,
        MAX_RETRIES: value,
        RETRY_DELAY_MS: value,
        TIMEOUT_SECONDS: value
      });

      expect(config.CACHE_DURATION).toBe(300);
      expect(config.MAX_RETRIES).toBe(3);
      expect(config.RETRY_DELAY_MS).toBe(1000);
      expect(config.TIMEOUT_SECONDS).toBe(30);
    });

    it('should still accept numeric and trimmed numeric runtime overrides', () => {
      const config = createConfig({
        CACHE_DURATION: ' 60 ',
        MAX_PATH_LENGTH: 4096,
        MAX_RETRIES: '2',
        RETRY_DELAY_MS: ' 0 ',
        TIMEOUT_SECONDS: 45
      });

      expect(config.CACHE_DURATION).toBe(60);
      expect(config.MAX_RETRIES).toBe(2);
      expect(config.RETRY_DELAY_MS).toBe(0);
      expect(config.SECURITY.MAX_PATH_LENGTH).toBe(4096);
      expect(config.TIMEOUT_SECONDS).toBe(45);
    });
  });

  describe('isGitRequest', () => {
    it('should identify Git info/refs requests', () => {
      const request = new Request('https://example.com/repo.git/info/refs');
      const url = new URL(request.url);

      expect(isGitRequest(request, url)).toBe(true);
    });

    it('should identify Git requests by User-Agent', () => {
      const request = new Request('https://example.com/repo.git', {
        headers: { 'User-Agent': 'git/2.34.1' }
      });
      const url = new URL(request.url);

      expect(isGitRequest(request, url)).toBe(true);
    });

    it('should not identify regular file requests as Git', () => {
      const request = new Request('https://example.com/repo/file.txt');
      const url = new URL(request.url);

      expect(isGitRequest(request, url)).toBe(false);
    });
  });

  describe('isGitLFSRequest', () => {
    it('should identify LFS batch API requests', () => {
      const request = new Request('https://example.com/repo.git/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.git-lfs+json' }
      });
      const url = new URL(request.url);

      expect(isGitLFSRequest(request, url)).toBe(true);
    });

    it('should identify LFS requests by User-Agent', () => {
      const request = new Request('https://example.com/repo.git', {
        headers: { 'User-Agent': 'git-lfs/3.0.0 (GitHub; darwin amd64; go 1.17.2)' }
      });
      const url = new URL(request.url);

      expect(isGitLFSRequest(request, url)).toBe(true);
    });

    it('should not identify regular file requests as LFS', () => {
      const request = new Request('https://example.com/repo/file.txt');
      const url = new URL(request.url);

      expect(isGitLFSRequest(request, url)).toBe(false);
    });
  });

  describe('validateRequest', () => {
    it('should allow GET requests', () => {
      const request = new Request('https://example.com/test', { method: 'GET' });
      const url = new URL(request.url);

      const result = validateRequest(request, url, createConfig());
      expect(result.valid).toBe(true);
    });

    it('should allow POST requests for Git operations', () => {
      const request = new Request('https://example.com/repo.git/git-upload-pack', {
        method: 'POST',
        headers: { 'User-Agent': 'git/2.34.1' }
      });
      const url = new URL(request.url);

      const result = validateRequest(request, url, createConfig());
      expect(result.valid).toBe(true);
    });

    it('should reject encoded traversal attempts against the production validator', () => {
      const request = new Request('https://example.com/gh/user/repo/%2e%2e%2fsecret');
      const url = new URL(request.url);

      const result = validateRequest(request, url, createConfig());
      expect(result.valid).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should reject raw traversal sequences from the original request URL', () => {
      const request = /** @type {Request} */ ({
        headers: new Headers(),
        method: 'GET',
        url: 'https://example.com/gh/user/repo/../secret'
      });
      const url = new URL('https://example.com/gh/user/secret');

      const result = validateRequest(request, url, createConfig());
      expect(result.valid).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should reject paths containing ASCII control characters', () => {
      const baseUrl = new URL('https://example.com/gh/user/repo/%00file');
      const request = /** @type {Request} */ ({
        headers: new Headers(),
        method: 'GET',
        url: 'https://example.com/gh/user/repo/%00file'
      });
      const url = /** @type {URL} */ ({
        origin: 'https://example.com',
        pathname: '/gh/user/repo/\u0000file',
        searchParams: baseUrl.searchParams
      });

      const result = validateRequest(request, url, createConfig());
      expect(result.valid).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should reject malformed percent-encoded paths', () => {
      const baseUrl = new URL('https://example.com/gh/user/repo/%E0%A4%A');
      const request = /** @type {Request} */ ({
        headers: new Headers(),
        method: 'GET',
        url: 'https://example.com/gh/user/repo/%E0%A4%A'
      });
      const url = /** @type {URL} */ ({
        origin: 'https://example.com',
        pathname: '/gh/user/repo/%E0%A4%A',
        searchParams: baseUrl.searchParams
      });

      const result = validateRequest(request, url, createConfig());
      expect(result.valid).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should reject unsupported methods for regular requests', () => {
      const request = new Request('https://example.com/gh/user/repo/file.txt', { method: 'PATCH' });
      const url = new URL(request.url);

      const result = validateRequest(request, url, createConfig());
      expect(result.valid).toBe(false);
      expect(result.status).toBe(405);
    });

    it('should reject paths longer than the configured maximum', () => {
      const request = new Request(`https://example.com/gh/${'a'.repeat(200)}`);
      const url = new URL(request.url);

      const result = validateRequest(request, url, createConfig({ MAX_PATH_LENGTH: '32' }));
      expect(result.valid).toBe(false);
      expect(result.status).toBe(414);
    });
  });

  describe('getAllowedMethods', () => {
    it('should respect configured methods for regular requests', () => {
      const config = createConfig({ ALLOWED_METHODS: 'GET,HEAD,POST' });
      const request = new Request('https://example.com/gh/test/repo/issues', { method: 'POST' });
      const url = new URL(request.url);

      expect(getAllowedMethods(request, url, config)).toEqual(['GET', 'HEAD', 'POST']);
    });

    it('should allow mutating methods for Hugging Face API endpoints', () => {
      const request = new Request('https://example.com/hf/token', { method: 'DELETE' });
      const url = new URL(request.url);

      expect(getAllowedMethods(request, url)).toEqual([
        'GET',
        'HEAD',
        'POST',
        'PUT',
        'PATCH',
        'DELETE'
      ]);
    });
  });

  describe('isDockerRequest', () => {
    it('should identify canonical registry API paths', () => {
      const request = new Request('https://example.com/cr/ghcr/v2/demo/manifests/latest');
      const url = new URL(request.url);

      expect(isDockerRequest(request, url)).toBe(true);
    });

    it('should identify Docker requests by user agent or manifest headers', () => {
      const userAgentRequest = new Request('https://example.com/cr/docker/library/nginx', {
        headers: { 'User-Agent': 'docker/27.0.0' }
      });
      const acceptRequest = new Request('https://example.com/cr/docker/library/nginx', {
        headers: { Accept: 'application/vnd.oci.image.manifest.v1+json' }
      });
      const contentTypeRequest = new Request('https://example.com/cr/docker/library/nginx', {
        headers: { 'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json' }
      });

      expect(isDockerRequest(userAgentRequest, new URL(userAgentRequest.url))).toBe(true);
      expect(isDockerRequest(acceptRequest, new URL(acceptRequest.url))).toBe(true);
      expect(isDockerRequest(contentTypeRequest, new URL(contentTypeRequest.url))).toBe(true);
    });

    it('should not treat generic /cr/ requests as Docker traffic without registry hints', () => {
      const request = new Request('https://example.com/cr/docker/library/nginx/readme');
      const url = new URL(request.url);

      expect(isDockerRequest(request, url)).toBe(false);
    });
  });

  describe('addSecurityHeaders', () => {
    it('should add all required security headers', () => {
      const headers = new Headers();
      const result = addSecurityHeaders(headers);

      expect(result.get('Strict-Transport-Security')).toContain('max-age=31536000');
      expect(result.get('X-Frame-Options')).toBe('DENY');
      expect(result.get('X-XSS-Protection')).toBe('1; mode=block');
      expect(result.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(result.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(result.get('Permissions-Policy')).toContain('interest-cohort=()');
    });

    it('should return the same Headers object', () => {
      const headers = new Headers();
      const result = addSecurityHeaders(headers);

      expect(result).toBe(headers);
    });
  });

  describe('resolveAllowedOrigin', () => {
    it('should return the matching origin from the production config', () => {
      const config = createConfig({ ALLOWED_ORIGINS: 'https://app.example.com' });
      const request = new Request('https://example.com/gh/test/repo', {
        headers: { Origin: 'https://app.example.com' }
      });

      expect(resolveAllowedOrigin(request, config)).toBe('https://app.example.com');
    });

    it('should reject origins that are not configured', () => {
      const config = createConfig({ ALLOWED_ORIGINS: 'https://app.example.com' });
      const request = new Request('https://example.com/gh/test/repo', {
        headers: { Origin: 'https://evil.example.com' }
      });

      expect(resolveAllowedOrigin(request, config)).toBeNull();
    });

    it('should allow any origin when wildcard CORS is configured', () => {
      const config = createConfig({ ALLOWED_ORIGINS: '*' });
      const request = new Request('https://example.com/gh/test/repo', {
        headers: { Origin: 'https://app.example.com' }
      });

      expect(resolveAllowedOrigin(request, config)).toBe('*');
    });
  });

  describe('addCorsHeaders', () => {
    it('should append allow headers and preserve existing Vary values', () => {
      const config = createConfig({ ALLOWED_ORIGINS: '*' });
      const request = new Request('https://example.com/gh/test/repo', {
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Headers': 'X-Test-Header'
        }
      });

      const headers = addCorsHeaders(new Headers({ Vary: 'Accept-Encoding' }), request, config);

      expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(headers.get('Access-Control-Allow-Headers')).toBe('X-Test-Header');
      expect(headers.get('Vary')).toBe('Accept-Encoding, Origin');
    });
  });

  describe('createErrorResponse', () => {
    it('should create a plain-text error response with security headers', async () => {
      const response = createErrorResponse('Bad Request', 400);

      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).toBe('text/plain');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(await response.text()).toBe('Bad Request');
    });

    it('should create detailed JSON error responses when requested', async () => {
      const response = createErrorResponse('Unauthorized', 401, true);
      const body = await response.json();

      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(body).toMatchObject({
        error: 'Unauthorized',
        status: 401
      });
      expect(body.timestamp).toBeTruthy();
    });
  });
});
