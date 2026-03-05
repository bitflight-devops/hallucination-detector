#!/usr/bin/env node
'use strict';

/**
 * Shared proxy-aware GitHub API client factory.
 *
 * Creates an Octokit instance configured to route requests through the egress
 * proxy when HTTPS_PROXY or HTTP_PROXY is set in the environment. The proxy
 * handles DNS resolution — direct DNS to api.github.com is not required.
 *
 * Usage:
 *   const { createGitHubClient, OWNER, REPO } = require('./lib/github-client.cjs');
 *   const octokit = createGitHubClient();
 *
 * Required env vars:
 *   GITHUB_TOKEN — GitHub personal access token with appropriate scopes
 *
 * Optional env vars (auto-detected):
 *   HTTPS_PROXY / HTTP_PROXY — egress proxy URL; if set, all GitHub API
 *     requests are routed through it via undici ProxyAgent
 */

const { Octokit } = require('octokit');
const { ProxyAgent, fetch: undiciFetch } = require('undici');
const { OWNER, REPO } = require('./story-helpers.cjs');

/**
 * Build a fetch wrapper that routes every request through the given proxy URL.
 *
 * The ProxyAgent is passed as `dispatcher` in the fetch init object, which is
 * the correct undici API. The URL and init are forwarded unchanged so the
 * wrapper is transparent to Octokit's request layer.
 *
 * @param {string} proxyUrl - Full proxy URL including credentials, e.g. http://user:pass@host:port
 * @returns {(url: string | URL, opts?: RequestInit) => Promise<Response>}
 */
function createProxyFetch(proxyUrl) {
  const dispatcher = new ProxyAgent(proxyUrl);
  return (url, opts) => undiciFetch(url, { ...opts, dispatcher });
}

/**
 * Create and return a proxy-aware Octokit instance.
 *
 * Reads GITHUB_TOKEN from the environment — exits with a non-zero status code
 * if the token is missing. When HTTPS_PROXY or HTTP_PROXY is set, configures
 * undici's ProxyAgent as the fetch dispatcher so all API calls route through
 * the egress proxy. Falls back to standard Octokit (Node.js default fetch)
 * when no proxy env var is present.
 *
 * @returns {import('octokit').Octokit}
 */
function createGitHubClient() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('ERROR: GITHUB_TOKEN is not set');
    process.exit(1);
  }

  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? null;

  if (proxyUrl) {
    const proxyFetch = createProxyFetch(proxyUrl);
    return new Octokit({ auth: token, request: { fetch: proxyFetch } });
  }

  return new Octokit({ auth: token });
}

module.exports = { createGitHubClient, OWNER, REPO };
