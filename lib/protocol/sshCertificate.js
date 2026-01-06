'use strict';

const { readUInt32BE } = require('./utils.js');

/**
 * Parse SSH certificate format from complete certificate buffer
 * RFC: https://cvsweb.openbsd.org/cgi-bin/cvsweb/~checkout~/src/usr.bin/ssh/PROTOCOL.certkeys?rev=1.17
 * 
 * Certificate format (for ssh-rsa-cert-v01@openssh.com):
 *   string    "ssh-rsa-cert-v01@openssh.com"
 *   string    nonce
 *   mpint     e (RSA exponent)
 *   mpint     n (RSA modulus)
 *   uint64    serial
 *   uint32    type (1=user, 2=host)
 *   string    key_id
 *   string    valid_principals
 *   uint64    valid_after
 *   uint64    valid_before
 *   string    critical_options
 *   string    extensions
 *   string    reserved
 *   string    signature_key
 *   string    signature
 */
function parseSSHCertificate(certBuffer) {
  if (!Buffer.isBuffer(certBuffer) || certBuffer.length < 8) {
    return new Error('Invalid certificate buffer');
  }

  let pos = 0;

  function readString() {
    if (pos + 4 > certBuffer.length) {
      throw new Error('Unexpected end of certificate');
    }
    const len = readUInt32BE(certBuffer, pos);
    pos += 4;
    if (pos + len > certBuffer.length) {
      throw new Error('Unexpected end of certificate');
    }
    const result = certBuffer.slice(pos, pos + len);
    pos += len;
    return result;
  }

  function readUInt64() {
    if (pos + 8 > certBuffer.length) {
      throw new Error('Unexpected end of certificate');
    }
    const result = certBuffer.readBigUInt64BE(pos);
    pos += 8;
    return result;
  }

  function readUInt32() {
    if (pos + 4 > certBuffer.length) {
      throw new Error('Unexpected end of certificate');
    }
    const result = readUInt32BE(certBuffer, pos);
    pos += 4;
    return result;
  }

  try {
    const cert = {};

    // 1. Type string
    const typeStr = readString().toString('utf8');
    cert.type = typeStr;

    // 2. Nonce (random bytes for uniqueness)
    cert.nonce = readString();

    // 3-4. Key-specific fields - skip them based on key type
    // For RSA: e (exponent), n (modulus)
    // For ECDSA: curve identifier, Q (point)
    // For ED25519: pk (public key)
    if (typeStr.startsWith('ssh-rsa')) {
      // RSA: e, n
      readString(); // e
      readString(); // n
    } else if (typeStr.startsWith('ecdsa-sha2-nistp')) {
      // ECDSA: curve, Q
      readString(); // curve identifier
      readString(); // Q
    } else if (typeStr.startsWith('ssh-ed25519')) {
      // ED25519: pk
      readString(); // pk
    } else if (typeStr.startsWith('ssh-dss')) {
      // DSA: p, q, g, y
      readString(); // p
      readString(); // q
      readString(); // g
      readString(); // y
    } else {
      return new Error(`Unsupported certificate type: ${typeStr}`);
    }

    // 5. Serial
    cert.serial = readUInt64();

    // 6. Type (1 = user cert, 2 = host cert)
    const typeNum = readUInt32();
    cert.certType = typeNum === 1 ? 'user' : typeNum === 2 ? 'host' : 'unknown';

    // 7. Key ID (comment/identifier)
    cert.keyId = readString().toString('utf8');

    // 8. Valid principals (array of valid user/host names)
    const principalsBuffer = readString();
    cert.principals = [];
    if (principalsBuffer.length > 0) {
      let pPos = 0;
      while (pPos < principalsBuffer.length) {
        const len = readUInt32BE(principalsBuffer, pPos);
        pPos += 4;
        cert.principals.push(principalsBuffer.slice(pPos, pPos + len).toString('utf8'));
        pPos += len;
      }
    }

    // 9. Valid after
    cert.validAfter = readUInt64();

    // 10. Valid before
    cert.validBefore = readUInt64();

    // 11. Critical options
    const criticalBuffer = readString();
    cert.criticalOptions = {};
    if (criticalBuffer.length > 0) {
      let cPos = 0;
      while (cPos < criticalBuffer.length) {
        const nameLen = readUInt32BE(criticalBuffer, cPos);
        cPos += 4;
        const name = criticalBuffer.slice(cPos, cPos + nameLen).toString('utf8');
        cPos += nameLen;
        const dataLen = readUInt32BE(criticalBuffer, cPos);
        cPos += 4;
        const data = criticalBuffer.slice(cPos, cPos + dataLen);
        cPos += dataLen;
        cert.criticalOptions[name] = data;
      }
    }

    // 12. Extensions
    const extensionsBuffer = readString();
    cert.extensions = {};
    if (extensionsBuffer.length > 0) {
      let ePos = 0;
      while (ePos < extensionsBuffer.length) {
        const nameLen = readUInt32BE(extensionsBuffer, ePos);
        ePos += 4;
        const name = extensionsBuffer.slice(ePos, ePos + nameLen).toString('utf8');
        ePos += nameLen;
        const dataLen = readUInt32BE(extensionsBuffer, ePos);
        ePos += 4;
        const data = extensionsBuffer.slice(ePos, ePos + dataLen);
        ePos += dataLen;
        cert.extensions[name] = data;
      }
    }

    // 13. Reserved (currently unused)
    readString();

    // 14. Signature key
    cert.signatureKeyBlob = readString();

    // 15. Signature
    cert.signature = readString();

    return cert;
  } catch (err) {
    return err;
  }
}

/**
 * Check if a buffer represents an SSH certificate
 */
function isCertificate(data) {
  if (!Buffer.isBuffer(data) || data.length < 16) {
    return false;
  }

  try {
    // Check if the type string indicates a certificate (ends with -cert-v01@openssh.com or similar)
    if (data.length < 4) {
      return false;
    }

    const len = readUInt32BE(data, 0);
    if (len > 64 || data.length < 4 + len) {
      return false;
    }

    const type = data.slice(4, 4 + len).toString('utf8');
    return type.includes('-cert-v');
  } catch {
    return false;
  }
}

/**
 * Check if a certificate is valid for the given username
 */
function validateCertificate(cert, username) {
  if (cert instanceof Error) {
    return { valid: false, reason: cert.message };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  // Check if currently expired
  if (cert.validBefore && now >= cert.validBefore) {
    return { valid: false, reason: 'Certificate has expired' };
  }

  // Check if not yet valid
  if (cert.validAfter && now < cert.validAfter) {
    return { valid: false, reason: 'Certificate is not yet valid' };
  }

  // Check if username is in principals (for user certificates)
  if (cert.certType === 'user' && cert.principals && cert.principals.length > 0) {
    if (!cert.principals.includes(username)) {
      return {
        valid: false,
        reason: `Username "${username}" not in certificate principals: ${cert.principals.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

module.exports = {
  parseSSHCertificate,
  isCertificate,
  validateCertificate,
};
