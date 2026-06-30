'use strict';

// Integration test for SM2/SM3/SM4 (Chinese national cryptographic standards) support.
// This test runs a local SSH server using the ssh2 library with GM algorithms
// and verifies that a client can connect using SM2 key exchange, SM4 cipher,
// SM3 MAC, and SM2 host key authentication.
//
// Run: node test/integration/test-sm-ssh.js
//
// Prerequisites:
//   - Node.js >= 16 with OpenSSL 1.1.1+ (for SM2/SM3/SM4 support)
//   - The ssh2 library must be built (node install.js)

const { Client, Server } = require('../../lib/index.js');
const { parseKey } = require('../../lib/protocol/keyParser.js');
const keygen = require('../../lib/keygen.js');
const assert = require('assert');
const net = require('net');

const TEST_PORT = 22222;
const TEST_HOST = '127.0.0.1';

// SM2/SM3/SM4 algorithm configurations to test
const GM_ALGORITHM_CONFIGS = [
  {
    name: 'sm4-ctr + hmac-sm3-etm',
    cipher: 'sm4-ctr',
    hmac: 'hmac-sm3-etm@openssh.com',
  },
  {
    name: 'sm4-ctr + hmac-sm3',
    cipher: 'sm4-ctr',
    hmac: 'hmac-sm3',
  },
  {
    name: 'sm4-cbc + hmac-sm3-etm',
    cipher: 'sm4-cbc',
    hmac: 'hmac-sm3-etm@openssh.com',
  },
  {
    name: 'sm4-cbc + hmac-sm3',
    cipher: 'sm4-cbc',
    hmac: 'hmac-sm3',
  },
];

const GM_KEX = 'sm2kep-sha3-sm3';
const GM_HOST_KEY = 'ssh-sm2';

let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  return new Promise((resolve) => {
    fn().then(
      () => {
        passCount++;
        console.log(`  PASS: ${name}`);
        resolve();
      },
      (err) => {
        failCount++;
        console.error(`  FAIL: ${name}`);
        console.error(`    ${err.message}`);
        resolve();
      }
    );
  });
}

async function main() {
  console.log('=== SM2/SM3/SM4 Integration Tests ===\n');

  // Check SM2/SM3/SM4 support
  const constants = require('../../lib/protocol/constants.js');
  const crypto = require('crypto');
  console.log(`Node.js ${process.version}, OpenSSL ${process.versions.openssl}\n`);
  
  if (!constants.sm2Supported) {
    console.error('SM2 is not supported on this system.');
    console.error('SM2 signing requires Node.js 18+ (OpenSSL 3.0+).');
    console.error('Node.js 16 (OpenSSL 1.1.1) has partial support but SM2 sign/verify fails.');
    process.exit(1);
  }
  if (!constants.sm3Supported) {
    console.error('SM3 is not supported on this system.');
    process.exit(1);
  }
  if (!constants.sm4Supported) {
    console.error('SM4 is not supported on this system.');
    process.exit(1);
  }
  console.log('SM2/SM3/SM4 support detected.\n');

  // Generate SM2 host key and user key
  console.log('Generating SM2 keys...');
  const hostKeyResult = keygen.generateKeyPairSync('sm2', { comment: 'test-host-key' });
  const userKeyResult = keygen.generateKeyPairSync('sm2', { comment: 'test-user-key' });

  const hostKey = hostKeyResult.private; // Raw PEM string for Server
  const hostKeyParsed = parseKey(hostKey); // Parsed for assertions
  const userPrivKey = parseKey(userKeyResult.private);
  const userPubKey = parseKey(userKeyResult.public);
  // Raw key strings for client.connect (it requires string or Buffer, not parsed keys)
  const userPrivKeyPEM = userKeyResult.private;
  const userPubKeyPEM = userKeyResult.public;

  assert(!(hostKeyParsed instanceof Error), 'Failed to parse host key');
  assert(!(userPrivKey instanceof Error), 'Failed to parse user private key');
  assert(!(userPubKey instanceof Error), 'Failed to parse user public key');
  assert.strictEqual(hostKeyParsed.type, 'ssh-sm2');
  assert.strictEqual(userPrivKey.type, 'ssh-sm2');
  assert.strictEqual(userPubKey.type, 'ssh-sm2');
  console.log('SM2 keys generated and parsed successfully.\n');

  // Small delay to ensure RNG pool is initialized
  await new Promise(resolve => setTimeout(resolve, 10));

  // Test 1: Key generation and parsing
  await test('SM2 key generation produces valid keys', async () => {
    const result = keygen.generateKeyPairSync('sm2', { comment: 'verify-key' });
    const parsed = parseKey(result.private);
    assert(!(parsed instanceof Error), 'Parse should succeed');
    assert.strictEqual(parsed.type, 'ssh-sm2');
    assert.strictEqual(parsed.comment, 'verify-key');

    // Sign and verify
    const data = Buffer.from('test data');
    const sig = parsed.sign(data, 'sm3');
    assert(!(sig instanceof Error), 'Sign should succeed');
    assert(Buffer.isBuffer(sig), 'Signature should be a Buffer');

    const pubParsed = parseKey(result.public);
    const verified = pubParsed.verify(data, sig, 'sm3');
    assert.strictEqual(verified, true, 'Verify should succeed');
  });

  // Test 2: SM2 ECDH key exchange
  await test('SM2 ECDH key exchange works', async () => {
    const crypto = require('crypto');
    const ecdh1 = crypto.createECDH('SM2');
    const k1 = ecdh1.generateKeys();
    const ecdh2 = crypto.createECDH('SM2');
    const k2 = ecdh2.generateKeys();
    const s1 = ecdh1.computeSecret(k2);
    const s2 = ecdh2.computeSecret(k1);
    assert(s1.equals(s2), 'ECDH secrets should match');
    assert.strictEqual(s1.length, 32, 'Secret should be 32 bytes');
  });

  // Test 3: SM4 cipher round-trip
  await test('SM4-CTR cipher round-trip', async () => {
    const crypto = require('crypto');
    const key = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const plaintext = Buffer.from('Hello SM4 encryption test data!');
    const enc = Buffer.concat([
      crypto.createCipheriv('sm4-ctr', key, iv).update(plaintext),
    ]);
    const dec = Buffer.concat([
      crypto.createDecipheriv('sm4-ctr', key, iv).update(enc),
    ]);
    assert(dec.equals(plaintext), 'Decrypted text should match');
  });

  // Test 4: SM3 hash and HMAC
  await test('SM3 hash and HMAC', async () => {
    const crypto = require('crypto');
    const hash = crypto.createHash('sm3').update('abc').digest('hex');
    // Known SM3 test vector for "abc"
    assert.strictEqual(
      hash,
      '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0',
      'SM3 hash of "abc" should match known test vector'
    );

    const hmac = crypto.createHmac('sm3', Buffer.from('key'));
    hmac.update('data');
    const hmacResult = hmac.digest();
    assert.strictEqual(hmacResult.length, 32, 'HMAC-SM3 should be 32 bytes');
  });

  // Test 5-8: Full SSH client-server handshake with each algorithm config
  for (const config of GM_ALGORITHM_CONFIGS) {
    await test(`SSH handshake: ${config.name}`, async () => {
      await runHandshakeTest({
        hostKey,
        userPrivKey: userPrivKeyPEM,
        userPubKey,
        cipher: config.cipher,
        hmac: config.hmac,
      });
    });
  }

  // Test 9: SSH exec with SM2/SM3/SM4
  await test('SSH exec command over GM connection', async () => {
    await runExecTest({
      hostKey,
      userPrivKey: userPrivKeyPEM,
      userPubKey,
    });
  });

  // Test 10: SSH password auth with SM2/SM3/SM4
  await test('SSH password auth over GM connection', async () => {
    await runPasswordAuthTest({
      hostKey,
    });
  });

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Total: ${testCount}, Passed: ${passCount}, Failed: ${failCount}`);
  if (failCount > 0) {
    process.exit(1);
  }
}

function createGMServer(hostKey, userPubKey, authConfig) {
  return new Server({
    hostKeys: [hostKey],
    algorithms: {
      kex: [GM_KEX],
      serverHostKey: [GM_HOST_KEY],
      cipher: ['sm4-ctr', 'sm4-cbc'],
      hmac: ['hmac-sm3-etm@openssh.com', 'hmac-sm3'],
    },
  }, (client) => {
    client.on('authentication', (ctx) => {
      if (authConfig && authConfig.acceptAll) {
        ctx.accept();
        return;
      }
      if (ctx.method === 'password' && ctx.username === 'testuser') {
        ctx.accept();
        return;
      }
      if (ctx.method === 'publickey' && ctx.username === 'testuser' && ctx.key) {
        // ctx.key is { algo, data } - compare raw SSH key data
        if (ctx.key.algo === 'ssh-sm2' &&
            userPubKey &&
            ctx.key.data.equals(userPubKey.getPublicSSH())) {
          ctx.accept();
          return;
        }
      }
      ctx.reject(['password', 'publickey']);
    });

    client.on('session', (accept) => {
      const session = accept();
      session.on('exec', (accept, reject, info) => {
        const channel = accept();
        if (info.command === 'echo hello') {
          channel.write('hello\n');
        } else {
          channel.write(`executed: ${info.command}\n`);
        }
        channel.exit(0);
        channel.end();
      });
      session.on('shell', (accept) => {
        const channel = accept();
        channel.write('$ ');
        channel.on('data', (data) => {
          const cmd = data.toString().trim();
          if (cmd === 'exit') {
            channel.end();
          } else {
            channel.write(`echo: ${cmd}\r\n$ `);
          }
        });
      });
    });
  });
}

function createGMClient(userPrivKey, algorithmConfig) {
  const client = new Client();
  const algorithms = {
    kex: [GM_KEX],
    serverHostKey: [GM_HOST_KEY],
  };
  if (algorithmConfig) {
    algorithms.cipher = [algorithmConfig.cipher];
    algorithms.hmac = [algorithmConfig.hmac];
  }
  return { client, algorithms };
}

function runHandshakeTest({ hostKey, userPrivKey, userPubKey, cipher, hmac }) {
  return new Promise((resolve, reject) => {
    const server = createGMServer(hostKey, userPubKey);
    const { client, algorithms } = createGMClient(userPrivKey, { cipher, hmac });

    server.listen(0, TEST_HOST, () => {
      const port = server.address().port;
      let connected = false;

      const timeout = setTimeout(() => {
        if (!connected) {
          client.end();
          server.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      client.connect({
        host: TEST_HOST,
        port,
        username: 'testuser',
        privateKey: userPrivKey,
        algorithms,
        hostVerifier: () => true, // Accept any host key
      });

      client.on('ready', () => {
        connected = true;
        clearTimeout(timeout);
        client.end();
      });

      client.on('close', () => {
        server.close();
        resolve();
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        server.close();
        reject(err);
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

function runExecTest({ hostKey, userPrivKey, userPubKey }) {
  return new Promise((resolve, reject) => {
    const server = createGMServer(hostKey, userPubKey);
    const { client, algorithms } = createGMClient(userPrivKey);

    server.listen(0, TEST_HOST, () => {
      const port = server.address().port;
      const timeout = setTimeout(() => {
        client.end();
        server.close();
        reject(new Error('Connection timeout'));
      }, 10000);

      client.connect({
        host: TEST_HOST,
        port,
        username: 'testuser',
        privateKey: userPrivKey,
        algorithms,
        hostVerifier: () => true,
      });

      client.on('ready', () => {
        client.exec('echo hello', (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            client.end();
            server.close();
            reject(err);
            return;
          }
          let output = '';
          stream.on('data', (data) => { output += data.toString(); });
          stream.on('close', (code) => {
            clearTimeout(timeout);
            try {
              assert.strictEqual(code, 0, 'Exit code should be 0');
              assert.strictEqual(output.trim(), 'hello', 'Output should be "hello"');
              client.end();
            } catch (err) {
              server.close();
              reject(err);
            }
          });
        });
      });

      client.on('close', () => {
        server.close();
        resolve();
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        server.close();
        reject(err);
      });
    });
  });
}

function runPasswordAuthTest({ hostKey }) {
  return new Promise((resolve, reject) => {
    const server = createGMServer(hostKey, null, { acceptAll: false });
    const { client, algorithms } = createGMClient(null);

    server.listen(0, TEST_HOST, () => {
      const port = server.address().port;
      const timeout = setTimeout(() => {
        client.end();
        server.close();
        reject(new Error('Connection timeout'));
      }, 10000);

      client.connect({
        host: TEST_HOST,
        port,
        username: 'testuser',
        password: 'testpassword',
        algorithms,
        hostVerifier: () => true,
      });

      client.on('ready', () => {
        clearTimeout(timeout);
        client.end();
      });

      client.on('close', () => {
        server.close();
        resolve();
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        server.close();
        reject(err);
      });
    });
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
