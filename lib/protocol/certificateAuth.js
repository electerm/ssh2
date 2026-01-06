'use strict';

const {
  parseSSHCertificate,
  isCertificate,
} = require('./sshCertificate.js');

/**
 * Handle SSH certificate public key authentication
 * This extends regular publickey auth to support certificates
 */

class CertificateKey {
  constructor(baseKey, certificate, certBuffer) {
    this.baseKey = baseKey; // The underlying parsed key
    this.certificate = certificate; // Parsed certificate data
    this.certBuffer = certBuffer; // Raw certificate buffer
    this.type = baseKey.type;
    this.comment = baseKey.comment;
  }

  isPrivateKey() {
    return this.baseKey.isPrivateKey();
  }

  getPublicPEM() {
    return this.baseKey.getPublicPEM?.();
  }

  getPublicSSH(algo) {
    return this.baseKey.getPublicSSH?.(algo);
  }

  sign(data, algo) {
    return this.baseKey.sign(data, algo);
  }

  verify(data, signature, algo) {
    return this.baseKey.verify(data, signature, algo);
  }

  getCertificate() {
    return this.certificate;
  }

  getCertificateBuffer() {
    return this.certBuffer;
  }
}

/**
 * Wrap a parsed key with certificate information
 */
function wrapKeyWithCertificate(key, certBuffer) {
  if (!Buffer.isBuffer(certBuffer)) {
    return new Error('Certificate must be a Buffer');
  }

  try {
    // Verify this is a certificate
    if (!isCertificate(certBuffer)) {
      return new Error('Buffer does not appear to be a certificate');
    }

    // Parse the certificate - it expects the complete buffer including type string
    const certificate = parseSSHCertificate(certBuffer);

    if (certificate instanceof Error) {
      return certificate;
    }

    return new CertificateKey(key, certificate, certBuffer);
  } catch (err) {
    return err;
  }
}

/**
 * Extract certificate from OpenSSH public key format
 * Returns { certBuffer, remainingData } or Error
 */
function extractCertificateFromData(data) {
  if (!Buffer.isBuffer(data)) {
    return new Error('Data must be a Buffer');
  }

  if (!isCertificate(data)) {
    return null; // Not a certificate
  }

  try {
    // The data is in binary SSH format: [type-len][type][data-len][data]...
    // For a certificate, the entire data IS the certificate
    return { certBuffer: data };
  } catch (err) {
    return err;
  }
}

module.exports = {
  CertificateKey,
  wrapKeyWithCertificate,
  extractCertificateFromData,
};
