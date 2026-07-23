# @electerm/ssh2

[English](README.md) | [中文](README_CN.md)

> A fork of [ssh2](https://github.com/mscdex/ssh2) — SSH2 client and server modules written in pure JavaScript for Node.js.

This library is designed for and used by **[electerm](https://github.com/electerm/electerm)**, an open-sourced terminal/ssh/sftp/ftp/telnet/serialport/RDP/VNC/Spice client for Linux, Mac, Windows, and Android.

## Installation

```bash
npm i @electerm/ssh2
```

## Additional Features

Built on top of the original `ssh2`, this fork adds the following features:

### SM2 / SM3 / SM4 (Chinese National Crypto) Support

Full support for Chinese national cryptographic standards (GM/T), with no native compilation required (pure JavaScript):

| Algorithm | Type | Description |
|-----------|------|-------------|
| `sm2kep-sha3-sm3` | Key Exchange | SM2 ECDH key exchange with SM3 hash |
| `ssh-sm2` | Host Key / Signature | SM2 signature with SM3 hash |
| `sm4-ctr`, `sm4-cbc` | Cipher | SM4 block cipher |
| `hmac-sm3`, `hmac-sm3-etm@openssh.com` | MAC | HMAC with SM3 hash |

See [SM Guide](docs/SM_GUIDE.md) for details.

### SSH Certificate Login

Authenticate using SSH certificates via the new `certificate` connect option:

```javascript
client.connect({
  host: '127.0.0.1',
  username: 'admin',
  privateKey: fs.readFileSync('/path/to/key'),
  certificate: fs.readFileSync('/path/to/cert'),  // SSH certificate
});
```

### Enhanced Keepalive

Both TCP-level (`SO_KEEPALIVE`) and SSH protocol-level keepalives to reliably detect and clean up dead connections.

### SFTP Non-UTF8 Encoding Support

Added an `encode` option to handle SFTP file names and shell output in non-UTF8 encodings (e.g. GBK):

```javascript
client.connect({
  // ...
  encode: 'gbk',
});
```

### Other Improvements & Fixes

- Support for `EXT_INFO` messages
- Fix zlib errors crashing the session
- Fix large text in SFTP headers breaking the connection
- Force RSA key support even when the server does not agree
- No native build required — replaces `optionalDependencies` with regular `dependencies`

## electerm Related Projects

| Project | Description |
|---------|-------------|
| [electerm](https://github.com/electerm/electerm) | Desktop app (Linux, Mac, Windows) |
| [electerm-web](https://github.com/electerm/electerm-web) | Browser-based version (including mobile) |
| [electerm-web-docker](https://github.com/electerm/electerm-web-docker) | Docker image for electerm-web |
| [electerm online](https://cloud.electerm.org) | Public free online app |
| [electerm demo](https://demo.electerm.org) | Online demo |
| [electerm-locales](https://github.com/electerm/electerm-locales) | Multi-language support |
| [electerm AI](https://ai.electerm.org) | Free AI for electerm users |
| [electerm-android](https://github.com/electerm/electerm-android) | Android app |

## License

MIT
