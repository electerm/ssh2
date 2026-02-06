/**
 * SSH Exec GBK Charset Test
 * Tests SSH exec command output with GBK encoded results
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { Client } = require('../lib/index.js');

// Test configuration
const TEST_HOST = 'localhost';
const TEST_PORT = 2224;
const TEST_USERNAME = 'testuser';
const KEY_PATH = path.join(__dirname, '..', 'temp', 'keys', 'test-cn-char-key');

test('SSH Exec GBK Charset Handling', async (t) => {
  await t.test('Key file should exist', () => {
    assert(fs.existsSync(KEY_PATH), `Key file not found: ${KEY_PATH}`);
  });

  await t.test('SSH exec command and output decoding', (t, done) => {
    const client = new Client();
    const privateKey = fs.readFileSync(KEY_PATH);

    // Set timeout for test
    const timeout = setTimeout(() => {
      client.end();
      done(new Error('SSH exec operation timed out'));
    }, 15000);

    client.on('ready', () => {
      let output = '';
      client.exec('ls /home/testuser/test_files', (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          return done(err);
        }

        stream.on('data', (data) => {
          output += iconv.decode(data, 'gbk');
        });

        stream.on('close', (code, signal) => {
          clearTimeout(timeout);
          client.end();

          if (code !== 0) {
            return done(new Error(`Command exited with code ${code}`));
          }

          // Check for properly decoded GBK output
          // Look for Chinese characters that indicate proper GBK decoding
          const hasGbkChars = /[\u4e00-\u9fff]/.test(output);

          assert(hasGbkChars, 'Should find GBK encoded output with Chinese characters');

          console.log('Successfully decoded GBK output from exec command');
          console.log('Sample output:', output.substring(0, 200) + '...');

          done();
        });

        stream.stderr.on('data', (data) => {
          console.error('stderr:', data.toString());
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      // Connection errors are expected if Docker container isn't running
      if (err.code === 'ECONNREFUSED') {
        console.log('Docker container not running, skipping test');
        done();
      } else {
        done(err);
      }
    });

    client.connect({
      host: TEST_HOST,
      port: TEST_PORT,
      username: TEST_USERNAME,
      privateKey,
      readyTimeout: 5000,
    });
  });
});