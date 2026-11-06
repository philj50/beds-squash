import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTBOUND_TO, resetRecipient } from '../scripts/outbound-mail.mjs';

test('password reset mail stays on the test inbox except one live account', () => {
  assert.equal(resetRecipient('someone@example.test', { live: true, name: 'Ada Player' }), OUTBOUND_TO);
  assert.equal(resetRecipient('alex@example.test', { live: false, name: 'Alex Buckhurst' }), OUTBOUND_TO);
  assert.equal(resetRecipient('alex@example.test', { live: true, name: 'Ada Player' }), OUTBOUND_TO);
  assert.equal(resetRecipient('p-abc@players.invalid', { live: true, name: 'Alex Buckhurst' }), OUTBOUND_TO);
  assert.equal(resetRecipient('alex@example.test', { live: true, name: '  Alex   Buckhurst ' }), 'alex@example.test');
});
