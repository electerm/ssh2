'use strict';

// Some hardened SSH servers strip the software version from the
// identification string, sending e.g. "SSH-2.0- \r\n" (empty software
// version). OpenSSH tolerates such banners, so make sure we do as well.

const assert = require('assert');
const Protocol = require('../lib/protocol/Protocol.js');

function parseIdent(raw) {
  return new Promise((resolve, reject) => {
    const proto = new Protocol({
      onWrite() {},
      onError: reject,
      onHeader: resolve,
      onPacket() {},
    });
    proto.parse(raw, 0, raw.length);
  });
}

(async () => {
  // Normal banner with a software version: unchanged behavior
  {
    const header = await parseIdent(Buffer.from('SSH-2.0-ssh2js1.0.0\r\n'));
    assert.strictEqual(header.versions.protocol, '2.0');
    assert.strictEqual(header.versions.software, 'ssh2js1.0.0');
  }

  // Empty software version, e.g. "SSH-2.0- \r\n": must be accepted
  {
    const header = await parseIdent(Buffer.from('SSH-2.0- \r\n'));
    assert.strictEqual(header.versions.protocol, '2.0');
    assert.strictEqual(header.versions.software, '');
  }

  // Truly invalid banners must still be rejected
  {
    await assert.rejects(parseIdent(Buffer.from('garbage\r\n')));
  }

  console.log('test-ident-banner: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
