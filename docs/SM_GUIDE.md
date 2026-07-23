# SM2/SM3/SM4 (国密算法) Usage Guide for ssh2

This guide explains how to use Chinese national cryptographic standards (GM/T) with the ssh2 library.

## Overview

The ssh2 library now supports the following Chinese national cryptographic algorithms:

| Algorithm | Type | Standard | Description |
|-----------|------|----------|-------------|
| `sm2kep-sha3-sm3` | Key Exchange | GM/T 0003-2012 | SM2 Elliptic Curve Diffie-Hellman Key Exchange with SM3 hash |
| `ssh-sm2` | Host Key / Signature | GM/T 0003-2012 | SM2 signature with SM3 hash |
| `sm4-ctr` | Cipher | GM/T 0004-2012 | SM4 block cipher in CTR mode |
| `sm4-cbc` | Cipher | GM/T 0004-2012 | SM4 block cipher in CBC mode |
| `hmac-sm3` | MAC | GM/T 0004-2016 | HMAC with SM3 hash |
| `hmac-sm3-etm@openssh.com` | MAC | GM/T 0004-2016 | HMAC-SM3 with Encrypt-then-MAC |

## Prerequisites

- **Node.js >= 16** with OpenSSL 1.1.1+ (Node.js 18+ recommended for native SM2 support)
- No native compilation required — ssh2 is pure JavaScript
- **Node.js 16 users**: Install `sm-polyfill` for full SM2 support:
  ```bash
  npm install sm-polyfill
  ```

### Node.js Version Compatibility

| Node.js Version | OpenSSL Version | SM2 Sign/Verify | SM3/SM4 | SM2 ECDH |
|-----------------|-----------------|-----------------|---------|----------|
| **18+** | 3.0+ | ✅ Native | ✅ | ✅ |
| **16** | 1.1.1 | ✅ With `sm-polyfill` | ✅ | ✅ |

**With `sm-polyfill` installed, Node.js 16 has full SM2/SM3/SM4 support** - identical to Node.js 18+.

The polyfill is automatically loaded when:
1. Node.js native SM2 sign/verify is not available (Node.js <=16)
2. The `sm-polyfill` package is installed

No code changes needed - just `npm install sm-polyfill` and everything works.

### Verify Support

```javascript
const constants = require('ssh2/lib/protocol/constants.js');

console.log('SM2 supported:', constants.sm2Supported);
console.log('SM3 supported:', constants.sm3Supported);
console.log('SM4 supported:', constants.sm4Supported);

// Or check directly:
const crypto = require('crypto');
console.log('OpenSSL version:', process.versions.openssl);
```

## Quick Start

### 1. Generate SM2 Keys

```javascript
const keygen = require('ssh2/lib/keygen.js');

// Generate SM2 host key
const hostKey = keygen.generateKeyPairSync('sm2', {
  comment: 'my-sm2-host-key',
});

// Generate SM2 user key
const userKey = keygen.generateKeyPairSync('sm2', {
  comment: 'my-sm2-user-key',
});

console.log('Host private key:');
console.log(hostKey.private);  // OpenSSH format PEM string

console.log('User public key:');
console.log(userKey.public);   // OpenSSH format public key string
```

### 2. Create a GM-Only SSH Server

```javascript
const { Server } = require('ssh2');
const keygen = require('ssh2/lib/keygen.js');

// Generate or load SM2 host key
const hostKeyResult = keygen.generateKeyPairSync('sm2', {
  comment: 'server-host-key',
});

const server = new Server({
  // Host key (raw PEM string or Buffer)
  hostKeys: [hostKeyResult.private],
  
  // Force GM algorithms only
  algorithms: {
    kex: ['sm2kep-sha3-sm3'],           // SM2 key exchange
    serverHostKey: ['ssh-sm2'],          // SM2 host key
    cipher: ['sm4-ctr', 'sm4-cbc'],     // SM4 ciphers
    hmac: ['hmac-sm3-etm@openssh.com', 'hmac-sm3'],  // SM3 MAC
  },
}, (client) => {
  client.on('authentication', (ctx) => {
    // Handle authentication
    if (ctx.method === 'publickey' && ctx.username === 'admin') {
      // ctx.key is { algo, data } - compare raw SSH key data
      if (ctx.key.algo === 'ssh-sm2' &&
          ctx.key.data.equals(expectedPubKeyBuffer)) {
        ctx.accept();
        return;
      }
    }
    if (ctx.method === 'password' && ctx.username === 'admin') {
      ctx.accept();
      return;
    }
    ctx.reject(['publickey', 'password']);
  });

  client.on('session', (accept) => {
    const session = accept();
    session.on('exec', (accept, reject, info) => {
      const channel = accept();
      channel.write(`Executing: ${info.command}\n`);
      channel.exit(0);
      channel.end();
    });
  });
});

server.listen(2222, () => {
  console.log('GM SSH server listening on port 2222');
});
```

### 3. Connect with GM Algorithms

```javascript
const { Client } = require('ssh2');
const fs = require('fs');

const client = new Client();

client.connect({
  host: '127.0.0.1',
  port: 2222,
  username: 'admin',
  
  // SM2 private key (PEM string or Buffer)
  privateKey: fs.readFileSync('/path/to/sm2_user_key'),
  
  // Force GM algorithms
  algorithms: {
    kex: ['sm2kep-sha3-sm3'],
    serverHostKey: ['ssh-sm2'],
    cipher: ['sm4-ctr'],                    // or 'sm4-cbc'
    hmac: ['hmac-sm3-etm@openssh.com'],     // or 'hmac-sm3'
  },
  
  // Verify host key fingerprint
  hostVerifier: (fingerprint) => {
    // Compare with expected SM2 host key fingerprint
    console.log('Host key fingerprint:', fingerprint);
    return true;  // Accept for demo purposes
  },
});

client.on('ready', () => {
  console.log('Connected with SM2/SM3/SM4!');
  
  client.exec('whoami', (err, stream) => {
    stream.on('data', (data) => {
      console.log(data.toString());
    });
    stream.on('close', () => {
      client.end();
    });
  });
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});
```

## Algorithm Configuration

### Mixed Algorithm Support

You can configure the server/client to support both GM and standard algorithms:

```javascript
const server = new Server({
  hostKeys: [
    sm2HostKey,      // SM2 host key
    rsaHostKey,      // RSA host key (fallback)
  ],
  algorithms: {
    kex: [
      'sm2kep-sha3-sm3',           // Preferred: SM2
      'curve25519-sha256',          // Fallback: standard
      'ecdh-sha2-nistp256',
    ],
    serverHostKey: [
      'ssh-sm2',                    // Preferred: SM2
      'ssh-ed25519',                // Fallback: standard
      'rsa-sha2-512',
    ],
    cipher: [
      'sm4-ctr',                    // Preferred: SM4
      'aes256-gcm@openssh.com',     // Fallback: standard
      'aes128-ctr',
    ],
    hmac: [
      'hmac-sm3-etm@openssh.com',   // Preferred: SM3
      'hmac-sha2-256-etm@openssh.com',
    ],
  },
}, ...);
```

### Client-Side Algorithm Selection

```javascript
client.connect({
  // ...
  algorithms: {
    // Specify preferred order
    kex: ['sm2kep-sha3-sm3', 'curve25519-sha256'],
    serverHostKey: ['ssh-sm2', 'ssh-ed25519'],
    cipher: ['sm4-ctr', 'aes256-gcm@openssh.com'],
    hmac: ['hmac-sm3-etm@openssh.com', 'hmac-sha2-256'],
  },
});
```

## Key Management

### Parse SM2 Keys

```javascript
const { parseKey } = require('ssh2/lib/protocol/keyParser.js');
const fs = require('fs');

// Parse private key
const privateKey = parseKey(fs.readFileSync('/path/to/sm2_key'));
if (privateKey instanceof Error) {
  console.error('Failed to parse key:', privateKey.message);
} else {
  console.log('Key type:', privateKey.type);  // 'ssh-sm2'
  console.log('Comment:', privateKey.comment);
}

// Parse public key
const publicKey = parseKey(fs.readFileSync('/path/to/sm2_key.pub'));
```

### Sign and Verify with SM2

```javascript
const { parseKey } = require('ssh2/lib/protocol/keyParser.js');
const keygen = require('ssh2/lib/keygen.js');

const keyResult = keygen.generateKeyPairSync('sm2');
const privateKey = parseKey(keyResult.private);
const publicKey = parseKey(keyResult.public);

const data = Buffer.from('data to sign');

// Sign
const signature = privateKey.sign(data, 'sm3');
console.log('Signature:', signature.toString('hex'));

// Verify
const verified = publicKey.verify(data, signature, 'sm3');
console.log('Verified:', verified);  // true
```

### Convert Key Formats

```javascript
const { parseKey } = require('ssh2/lib/protocol/keyParser.js');
const keygen = require('ssh2/lib/keygen.js');

// Generate key
const keyResult = keygen.generateKeyPairSync('sm2', {
  comment: 'my-key',
});

// Parse and get different formats
const privateKey = parseKey(keyResult.private);

console.log('OpenSSH PEM:');
console.log(privateKey.getPrivatePEM());

console.log('SSH public key:');
console.log(privateKey.getPublicSSH().toString('base64'));
```

## Docker Test Server

A Docker test server is provided in `temp/docker/sm-ssh/`:

```bash
cd temp/docker/sm-ssh

# Build and start
docker-compose up --build

# The server runs on port 2222 with SM2 host key
# Use SM2 client keys from temp/docker/sm-ssh/keys/
```

### Docker Server Configuration

The Docker server (`temp/docker/sm-ssh/server.js`) demonstrates:
- SM2 host key authentication
- SM2 key exchange (sm2kep-sha3-sm3)
- SM4 cipher (sm4-ctr, sm4-cbc)
- SM3 MAC (hmac-sm3, hmac-sm3-etm@openssh.com)
- Password and publickey authentication

## Integration Tests

Run the SM2/SM3/SM4 integration tests:

```bash
node test/integration/test-sm-ssh.js
```

Tests include:
1. SM2 key generation and parsing
2. SM2 ECDH key exchange
3. SM4 cipher round-trip
4. SM3 hash and HMAC (with known test vectors)
5. SSH handshake with various algorithm combinations
6. SSH exec command over GM connection
7. SSH password authentication over GM connection

## Troubleshooting

### "SM2/SM3/SM4 not supported"

Check your Node.js version and OpenSSL version:

```bash
node -e "console.log('Node:', process.version); console.log('OpenSSL:', process.versions.openssl)"
```

**If on Node.js 16**: Install `sm-polyfill` for full SM2 support:
```bash
npm install sm-polyfill
```

**If on Node.js 18+**: All SM algorithms are natively supported. If you still see this error, ensure you are using the latest version of ssh2.

### Using SM3/SM4 on Node.js 16 (Without sm-polyfill)

If you don't want to install `sm-polyfill`, you can still use SM3/SM4 on Node.js 16 by using a non-SM2 host key algorithm:

```javascript
const { Server } = require('ssh2');
const fs = require('fs');

// Use ed25519 or RSA for host key instead of SM2
const server = new Server({
  hostKeys: [fs.readFileSync('/path/to/ed25519_host_key')],
  algorithms: {
    // SM2 key exchange still works on Node.js 16
    kex: ['sm2kep-sha3-sm3', 'curve25519-sha256'],
    // Use ed25519 for host key (not SM2)
    serverHostKey: ['ssh-ed25519', 'ssh-sm2'],
    // SM4 ciphers work on Node.js 16
    cipher: ['sm4-ctr', 'aes256-gcm@openssh.com'],
    // SM3 MAC works on Node.js 16
    hmac: ['hmac-sm3-etm@openssh.com', 'hmac-sha2-256'],
  },
}, ...);
```

This gives you SM3 MAC and SM4 cipher encryption while using ed25519 for host key authentication.

### "Cannot parse privateKey"

The `privateKey` option in `client.connect()` must be a string or Buffer (PEM format), not a parsed key object:

```javascript
// Correct
client.connect({
  privateKey: fs.readFileSync('/path/to/key'),  // Buffer
  // or
  privateKey: pemString,  // String
});

// Wrong
const parsedKey = parseKey(fs.readFileSync('/path/to/key'));
client.connect({
  privateKey: parsedKey,  // Error: parsed key object
});
```

### "All configured authentication methods failed"

Check that:
1. The client's public key matches the server's expected key
2. The algorithm names match (`ssh-sm2` for SM2 keys)
3. The server accepts the authentication method

### Host Key Verification

When connecting, you must verify the host key:

```javascript
client.connect({
  // ...
  hostVerifier: (fingerprint) => {
    // Compare with expected fingerprint
    return fingerprint === expectedFingerprint;
  },
});
```

## SM2 Key Format

SM2 keys in SSH format do NOT include a curve name field (unlike ECDSA):

**Public key:**
```
string    "ssh-sm2"
string    Q (uncompressed point, 65 bytes: 0x04 + X(32) + Y(32))
```

**Private key (OpenSSH format):**
```
string    "ssh-sm2"
string    Q (public key point)
string    d (private key scalar)
```

This is similar to ed25519 keys, which also omit the curve name.

## References

- GM/T 0003-2012: SM2 Elliptic Curve Public Key Cryptography Algorithm
- GM/T 0004-2012: SM3 Cryptographic Hash Algorithm
- GM/T 0002-2012: SM4 Block Cipher Algorithm
- GM/T 0004-2016: SM4 Cryptographic Application Specification
- RFC 4251: SSH Protocol Architecture
- RFC 4253: SSH Transport Layer Protocol
- RFC 4252: SSH Authentication Protocol
