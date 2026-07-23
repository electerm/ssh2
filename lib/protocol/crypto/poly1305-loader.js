'use strict';

// Poly1305 loader entry point.
//
// Tries to load the WebAssembly-compiled Poly1305 module first (for best
// performance).  If WASM is unavailable or the module fails to instantiate,
// falls back transparently to the pure JavaScript implementation.
//
// Both backends expose the same interface:
//
//   { backend: 'wasm' | 'pure-js',
//     resultBuffer: Buffer(16),
//     poly1305_auth(out, msg1, msg1Len, msg2, msg2Len, key) }
//
// `poly1305_auth` writes the 16-byte Poly1305 tag directly into `out`.
// `resultBuffer` is a pre-allocated 16-byte Buffer convenience slot that
// callers can pass as `out` and then read the result from.

const purePoly1305 = require('./poly1305_pure.js');

/**
 * @returns {Promise<{backend: string, resultBuffer: Buffer, poly1305_auth: Function}>}
 */
async function loadPoly1305() {
  // --- Try WASM backend -------------------------------------------------
  try {
    // Require lazily so that environments without WebAssembly don't crash
    // at import time — the error only surfaces inside this try block.
    const wasmModule = await require('./poly1305.js')();
    const wasmPtr = wasmModule._malloc(16);
    const wasmAuth = wasmModule.cwrap(
      'poly1305_auth',
      null,
      ['number', 'array', 'number', 'array', 'number', 'array']
    );

    const resultBuffer = Buffer.alloc(16);

    /**
     * WASM-backed poly1305_auth.
     * Writes into WASM heap, then copies the 16-byte tag into `out`.
     */
    function poly1305_auth(out, msg1, msg1Len, msg2, msg2Len, key) {
      wasmAuth(wasmPtr, msg1, msg1Len, msg2, msg2Len, key);
      out.set(
        new Uint8Array(wasmModule.HEAPU8.buffer, wasmPtr, 16),
        0
      );
    }

    return { backend: 'wasm', resultBuffer, poly1305_auth };
  } catch (err) {
    // Fall through to pure JS
  }

  // --- Fall back to pure JS ---------------------------------------------
  const resultBuffer = Buffer.alloc(16);
  return { backend: 'pure-js', resultBuffer, poly1305_auth: purePoly1305 };
}

module.exports = loadPoly1305;
