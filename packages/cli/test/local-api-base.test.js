import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_API_BASE, getApiBase } from '../src/runtime/profiles.js';

function configWith(apiBase) {
  return { current_profile: 'default', profiles: { default: { api_base: apiBase } } };
}

test('a leftover loopback api_base resolves to the live API, IPv6 [::1] included', () => {
  const saved = process.env.NOTIS_API_BASE;
  delete process.env.NOTIS_API_BASE;
  try {
    for (const apiBase of ['http://localhost:8123', 'http://127.0.0.1:8123', 'http://[::1]:8123']) {
      assert.equal(getApiBase(configWith(apiBase), 'default'), DEFAULT_API_BASE, apiBase);
    }
    // A custom endpoint keeps its pin.
    assert.equal(getApiBase(configWith('https://notis.example.com/'), 'default'), 'https://notis.example.com');
  } finally {
    if (saved !== undefined) process.env.NOTIS_API_BASE = saved;
  }
});
