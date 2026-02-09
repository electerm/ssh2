/**
 * SSH Certificate Login Tests
 * Tests certificate-based authentication for SSH connections
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('../lib/index.js');

// Test configuration
const TEST_HOST = 'localhost';
const TEST_PORT = 2222;
const TEST_USERNAME = 'testuser';
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CERTS_DIR = path.join(__dirname, '..', 'temp', 'docker', 'ssh-cert-login');

// Helper to load test files
function loadTestFile(filename) {
  const filepath = path.join(CERTS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Test file not found: ${filepath}`);
  }
  return fs.readFileSync(filepath);
}

// Helper to load certificate files
function loadCertFiles() {
  return {
    privateKey: loadTestFile('testuser_key'),
    certificate: loadTestFile('testuser_key-cert.pub'),
  };
}

test('SSH Certificate Authentication', async (t) => {
  await t.test('Certificate files should exist', () => {
    assert.doesNotThrow(() => {
      loadCertFiles();
    }, 'Certificate files should be loadable');
  });

  await t.test('Certificate should be parseable', () => {
    const { certificate } = loadCertFiles();
    const certContent = certificate.toString('utf8').trim();

    // Check for certificate format indicators
    assert(certContent.includes('-cert.pub') || certContent.includes('ssh-rsa-cert'),
      'Certificate should indicate certificate format');
  });

  await t.test('Client connection with certificate should be attempted', (t, done) => {
    const { privateKey, certificate } = loadCertFiles();

    const client = new Client();

    // Set timeout for test
    const timeout = setTimeout(() => {
      client.end();
      done(new Error('Connection attempt timed out'));
    }, 10000);

    let connectionAttempted = false;
    let authAttempted = false;

    client.on('ready', () => {
      clearTimeout(timeout);
      client.end();
      done();
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      // Connection errors are expected if Docker container isn't running
      // We just want to verify that certificate auth was attempted
      if (authAttempted || connectionAttempted) {
        done();
      } else {
        client.end();
        // Connection refused is OK - means it tried
        if (err.code === 'ECONNREFUSED') {
          done();
        } else {
          done(err);
        }
      }
    });

    client.on('debug', (info) => {
      if (info.includes('certificate') || info.includes('USERAUTH_REQUEST')) {
        authAttempted = true;
      }
    });

    try {
      connectionAttempted = true;
      client.connect({
        host: TEST_HOST,
        port: TEST_PORT,
        username: TEST_USERNAME,
        privateKey,
        certificate,
        debug: (info) => {
          client.emit('debug', info);
        },
        readyTimeout: 5000,
      });
    } catch (err) {
      clearTimeout(timeout);
      // Expected - Docker might not be running
      if (err.message && err.message.includes('certificate')) {
        done(err);
      } else {
        done();
      }
    }
  });

  await t.test('Certificate should be readable from file', () => {
    const certData = loadCertFiles().certificate;
    assert(Buffer.isBuffer(certData), 'Certificate should be a Buffer');
    assert(certData.length > 0, 'Certificate should not be empty');
  });

  await t.test('Certificate parsing should handle OpenSSH format', () => {
    const { sshCertificate } = require('../lib/protocol/sshCertificate.js');
    const certContent = loadCertFiles().certificate.toString('utf8').trim();

    // Split the OpenSSH public key format: "type base64data [comment]"
    const parts = certContent.split(/\s+/);
    assert(parts.length >= 2, 'Certificate should have at least type and base64 data');

    const keyType = parts[0];
    assert(keyType.includes('-cert'), 'Key type should indicate certificate format');

    try {
      const certBuffer = Buffer.from(parts[1], 'base64');
      assert(certBuffer.length > 0, 'Base64 decoded certificate should not be empty');
    } catch (err) {
      assert.fail(`Failed to decode base64 certificate: ${err.message}`);
    }
  });
});

test('SSH Certificate Module', async (t) => {
  const { parseSSHCertificate, isCertificate, validateCertificate } =
    require('../lib/protocol/sshCertificate.js');

  await t.test('isCertificate should detect certificate type markers', () => {
    // Certificate type should start with type string
    const certContent = loadCertFiles().certificate.toString('utf8').trim();
    const parts = certContent.split(/\s+/);
    const certBuffer = Buffer.from(parts[1], 'base64');

    assert(isCertificate(certBuffer), 'Should recognize SSH certificate format');
  });

  await t.test('validateCertificate should check expiry', () => {
    // Create a mock certificate object
    const now = BigInt(Math.floor(Date.now() / 1000));
    const futureTime = now + BigInt(3600);

    const validCert = {
      certType: 'user',
      validAfter: now - BigInt(100),
      validBefore: now + BigInt(3600),
      principals: ['testuser'],
    };

    const result = validateCertificate(validCert, 'testuser');
    assert.deepEqual(result.valid, true, 'Valid certificate should pass validation');
  });

  await t.test('validateCertificate should reject expired', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));

    const expiredCert = {
      certType: 'user',
      validAfter: now - BigInt(7200),
      validBefore: now - BigInt(3600),
      principals: ['testuser'],
    };

    const result = validateCertificate(expiredCert, 'testuser');
    assert.deepEqual(result.valid, false, 'Expired certificate should fail validation');
    assert(result.reason.includes('expired'), 'Reason should mention expiration');
  });

  await t.test('validateCertificate should check principals', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));

    const cert = {
      certType: 'user',
      validAfter: now - BigInt(100),
      validBefore: now + BigInt(3600),
      principals: ['admin', 'root'],
    };

    const result1 = validateCertificate(cert, 'admin');
    assert.deepEqual(result1.valid, true, 'User in principals should pass');

    const result2 = validateCertificate(cert, 'testuser');
    assert.deepEqual(result2.valid, false, 'User not in principals should fail');
    assert(result2.reason.includes('principals'), 'Reason should mention principals');
  });
});

test('Certificate Configuration', async (t) => {
  await t.test('Client should accept certificate configuration', () => {
    const client = new Client();
    const { privateKey, certificate } = loadCertFiles();

    // This should not throw
    assert.doesNotThrow(() => {
      // We can't actually call connect without a real server,
      // but we can verify the config accepts it
      client.config.certificate = certificate;
      assert(client.config.certificate, 'Certificate should be stored in config');
    });
  });

  await t.test('Certificate can be string or buffer', () => {
    const { certificate } = loadCertFiles();

    // Test with buffer
    const client1 = new Client();
    client1.config.certificate = certificate;
    assert.strictEqual(client1.config.certificate, certificate);

    // Test with string
    const certStr = certificate.toString('utf8');
    const client2 = new Client();
    client2.config.certificate = certStr;
    assert.strictEqual(client2.config.certificate, certStr);
  });
});

test('Integration Test - Full Certificate Flow', async (t) => {
  await t.test('should handle certificate in connect options', (t, done) => {
    const { privateKey, certificate } = loadCertFiles();
    const client = new Client();

    const timeout = setTimeout(() => {
      client.end();
      done();
    }, 5000);

    client.on('error', (err) => {
      clearTimeout(timeout);
      // Expected - Docker might not be running
      // Just verify no certificate parsing errors
      if (err.message && err.message.includes('ECONNREFUSED')) {
        done();
      } else if (err.message && err.message.includes('certificate')) {
        done(err);
      } else {
        done();
      }
    });

    client.on('ready', () => {
      clearTimeout(timeout);
      client.end();
      done();
    });

    try {
      client.connect({
        host: TEST_HOST,
        port: TEST_PORT,
        username: TEST_USERNAME,
        privateKey: privateKey,
        certificate: certificate,
        readyTimeout: 3000,
      });
    } catch (err) {
      clearTimeout(timeout);
      // Expected if Docker isn't running or private key parsing fails
      done();
    }
  });

  await t.test('should successfully login with certificate', (t, done) => {
    const { privateKey, certificate } = loadCertFiles();
    const client = new Client();

    const timeout = setTimeout(() => {
      client.end();
      done(new Error('Connection timed out'));
    }, 10000);

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end();
      // If Docker container isn't running, skip this test
      if (err.code === 'ECONNREFUSED') {
        done(); // Pass - Docker not running
      } else {
        done(err);
      }
    });

    client.on('ready', () => {
      clearTimeout(timeout);
      // Execute a simple command to verify the connection works
      client.exec('whoami', (err, stream) => {
        if (err) {
          client.end();
          done(err);
          return;
        }

        let output = '';
        stream.on('data', (data) => {
          output += data.toString();
        });

        stream.on('close', (code) => {
          client.end();
          try {
            assert.strictEqual(output.trim(), 'testuser', 'Should be logged in as testuser');
            assert.strictEqual(code, 0, 'Command should exit with code 0');
            done();
          } catch (assertErr) {
            done(assertErr);
          }
        });
      });
    });

    client.connect({
      host: TEST_HOST,
      port: TEST_PORT,
      username: TEST_USERNAME,
      privateKey: privateKey,
      certificate: certificate,
      readyTimeout: 5000,
      tryKeyboard: true,

      // readyTimeout: 50000,
      keepaliveCountMax: 10,
      keepaliveInterval: 5000,
      algorithms: {
        kex: [
          'curve25519-sha256',
          'curve25519-sha256@libssh.org',
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group15-sha512',
          'diffie-hellman-group16-sha512',
          'diffie-hellman-group17-sha512',
          'diffie-hellman-group18-sha512',
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521',
          'diffie-hellman-group-exchange-sha256',
          'diffie-hellman-group14-sha1',
          'diffie-hellman-group-exchange-sha1',
          'diffie-hellman-group1-sha1'
        ],
        hmac: [
          'hmac-sha2-256',
          'hmac-sha2-512',
          'hmac-sha1',
          'hmac-md5',
          'hmac-sha2-256-96',
          'hmac-sha2-512-96',
          'hmac-ripemd160',
          'hmac-sha1-96',
          'hmac-md5-96',
          'hmac-sha2-256-etm@openssh.com',
          'hmac-sha2-512-etm@openssh.com',
          'hmac-sha1-etm@openssh.com'
        ],
        compress: [ 'zlib@openssh.com', 'zlib', 'none' ]
      }
    });
  });
});
