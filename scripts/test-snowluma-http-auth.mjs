import assert from 'node:assert/strict';
import { snowLumaHttpAuthHeaders, snowLumaWsAccessToken } from '../src/snowluma-http-auth.js';

assert.deepEqual(
  snowLumaHttpAuthHeaders({ accessToken: 'ws-token', httpAccessToken: 'http-token' }),
  { authorization: 'Bearer http-token' },
  'HTTP actions use the HTTP endpoint token when it differs from the WS token'
);

assert.deepEqual(
  snowLumaHttpAuthHeaders({ accessToken: 'legacy-token' }),
  { authorization: 'Bearer legacy-token' },
  'existing configurations keep using accessToken when httpAccessToken is omitted'
);

assert.deepEqual(
  snowLumaHttpAuthHeaders({ accessToken: 'ws-token', httpAccessToken: '' }),
  { authorization: 'Bearer ws-token' },
  'an empty HTTP override falls back to the legacy shared token'
);

assert.equal(
  snowLumaWsAccessToken({ accessToken: 'legacy-token', wsAccessToken: 'ws-token' }),
  'ws-token',
  'WebSocket connections use the dedicated WS token when configured'
);

assert.equal(
  snowLumaWsAccessToken({ accessToken: 'legacy-token' }),
  'legacy-token',
  'existing configurations keep using accessToken for WebSocket connections'
);

console.log('SnowLuma HTTP/WS auth tests passed.');
