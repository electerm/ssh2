'use strict';

const assert = require('assert');
const { randomBytes } = require('crypto');

const purePoly1305 = require('../lib/protocol/crypto/poly1305_pure.js');
const loadPoly1305 = require('../lib/protocol/crypto/poly1305-loader.js');

(async () => {
  // ====================================================================
  // 1. Empty message
  // ====================================================================
  {
    const key = randomBytes(32);
    const out = Buffer.alloc(16);
    purePoly1305(out, Buffer.alloc(0), 0, Buffer.alloc(0), 0, key);
    // For an empty message, tag = s (low 128 bits of key[16..31])
    const expected = key.subarray(16, 32);
    assert.deepStrictEqual(
      Buffer.from(out).toString('hex'),
      expected.toString('hex'),
      'Empty message tag should equal s'
    );
    console.log('  [PASS] Empty message');
  }

  // ====================================================================
  // 2. Load the loader and determine which backend is active
  // ====================================================================
  const loaded = await loadPoly1305();
  console.log(`  Backend selected by loader: ${loaded.backend}`);

  // ====================================================================
  // 3. Cross-validate pure JS vs WASM (if WASM is available)
  // ====================================================================
  let wasmBackend = null;
  if (loaded.backend === 'wasm') {
    wasmBackend = loaded;
  } else {
    // Try to load WASM directly for cross-validation
    try {
      const wasmModule = await require('../lib/protocol/crypto/poly1305.js')();
      const wasmPtr = wasmModule._malloc(16);
      const wasmAuth = wasmModule.cwrap(
        'poly1305_auth', null,
        ['number', 'array', 'number', 'array', 'number', 'array']
      );
      wasmBackend = {
        resultBuffer: Buffer.alloc(16),
        poly1305_auth(out, msg1, msg1Len, msg2, msg2Len, key) {
          wasmAuth(wasmPtr, msg1, msg1Len, msg2, msg2Len, key);
          out.set(new Uint8Array(wasmModule.HEAPU8.buffer, wasmPtr, 16), 0);
        },
      };
    } catch {
      console.log('  WASM not available — skipping cross-validation');
    }
  }

  if (wasmBackend) {
    // --- 5a. Various message sizes with 4-byte split -------------------
    const sizes = [0, 1, 4, 8, 12, 15, 16, 17, 31, 32, 33, 63, 64,
                   100, 128, 255, 256, 1024, 4096, 16384, 32768];
    let passCount = 0;
    for (const size of sizes) {
      const key = randomBytes(32);
      const msg = randomBytes(size);
      const splitPoint = Math.min(4, size);

      const pureOut = Buffer.alloc(16);
      const wasmOut = Buffer.alloc(16);

      purePoly1305(
        pureOut,
        msg.subarray(0, splitPoint),
        splitPoint,
        msg.subarray(splitPoint),
        size - splitPoint,
        key
      );
      wasmBackend.poly1305_auth(
        wasmOut,
        msg.subarray(0, splitPoint),
        splitPoint,
        msg.subarray(splitPoint),
        size - splitPoint,
        key
      );

      assert.deepStrictEqual(
        pureOut.toString('hex'),
        wasmOut.toString('hex'),
        `Mismatch for size=${size}, split=${splitPoint}`
      );
      passCount++;
    }
    console.log(`  [PASS] Pure JS vs WASM cross-validation (${passCount} sizes)`);

    // --- 5b. Random split points ----------------------------------------
    let randPass = 0;
    for (let i = 0; i < 200; i++) {
      const key = randomBytes(32);
      const msg = randomBytes(1 + Math.floor(Math.random() * 500));
      const splitPoint = Math.floor(Math.random() * (msg.length + 1));

      const pureOut = Buffer.alloc(16);
      const wasmOut = Buffer.alloc(16);

      purePoly1305(
        pureOut,
        msg.subarray(0, splitPoint),
        splitPoint,
        msg.subarray(splitPoint),
        msg.length - splitPoint,
        key
      );
      wasmBackend.poly1305_auth(
        wasmOut,
        msg.subarray(0, splitPoint),
        splitPoint,
        msg.subarray(splitPoint),
        msg.length - splitPoint,
        key
      );

      assert.deepStrictEqual(
        pureOut.toString('hex'),
        wasmOut.toString('hex'),
        `Mismatch for random test #${i}: size=${msg.length}, split=${splitPoint}`
      );
      randPass++;
    }
    console.log(`  [PASS] Random split cross-validation (${randPass} cases)`);

    // --- 5c. Single-part (msg2 = empty) ---------------------------------
    let singlePass = 0;
    for (let i = 0; i < 100; i++) {
      const key = randomBytes(32);
      const msg = randomBytes(1 + Math.floor(Math.random() * 1000));

      const pureOut = Buffer.alloc(16);
      const wasmOut = Buffer.alloc(16);

      purePoly1305(pureOut, msg, msg.length, Buffer.alloc(0), 0, key);
      wasmBackend.poly1305_auth(wasmOut, msg, msg.length, Buffer.alloc(0), 0, key);

      assert.deepStrictEqual(
        pureOut.toString('hex'),
        wasmOut.toString('hex'),
        `Mismatch for single-part test #${i}: size=${msg.length}`
      );
      singlePass++;
    }
    console.log(`  [PASS] Single-part cross-validation (${singlePass} cases)`);
  }

  // ====================================================================
  // 4. Verify the loader's resultBuffer + poly1305_auth work together
  // ====================================================================
  {
    const key = randomBytes(32);
    const msg = randomBytes(64);

    loaded.poly1305_auth(
      loaded.resultBuffer,
      msg.subarray(0, 4),
      4,
      msg.subarray(4),
      msg.length - 4,
      key
    );

    const ref = Buffer.alloc(16);
    purePoly1305(ref, msg.subarray(0, 4), 4, msg.subarray(4),
                 msg.length - 4, key);

    assert.deepStrictEqual(
      Buffer.from(loaded.resultBuffer).toString('hex'),
      ref.toString('hex'),
      'Loader resultBuffer does not match pure JS'
    );
    console.log('  [PASS] Loader resultBuffer integration');
  }

  // ====================================================================
  // 5. Determinism: same input always gives same output
  // ====================================================================
  {
    const key = randomBytes(32);
    const msg = randomBytes(128);

    const out1 = Buffer.alloc(16);
    const out2 = Buffer.alloc(16);
    purePoly1305(out1, msg, msg.length, Buffer.alloc(0), 0, key);
    purePoly1305(out2, msg, msg.length, Buffer.alloc(0), 0, key);

    assert.deepStrictEqual(out1.toString('hex'), out2.toString('hex'));
    console.log('  [PASS] Determinism check');
  }

  console.log('\nAll Poly1305 tests passed.');
})().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
