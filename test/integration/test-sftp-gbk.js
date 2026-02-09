/**
 * SFTP GBK Charset Test
 * Tests SFTP directory listing with GBK encoded filenames
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('../lib/index.js');

// Test configuration
const TEST_HOST = 'localhost';
const TEST_PORT = 2224;
const TEST_USERNAME = 'testuser';
const TEST_PATH = '/home/testuser/test_files';
const KEY_PATH = path.join(__dirname, '..', 'temp', 'keys', 'test-cn-char-key');

test('SFTP GBK Charset Handling', async (t) => {
  await t.test('Key file should exist', () => {
    assert(fs.existsSync(KEY_PATH), `Key file not found: ${KEY_PATH}`);
  });

  await t.test('SFTP connection and directory listing', (t, done) => {
    const client = new Client();
    const privateKey = fs.readFileSync(KEY_PATH);

    // Set timeout for test
    const timeout = setTimeout(() => {
      client.end();
      done(new Error('SFTP operation timed out'));
    }, 15000);

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          return done(err);
        }

        sftp.readdir(TEST_PATH, (err, list) => {
          clearTimeout(timeout);
          client.end();

          if (err) return done(err);

          assert(Array.isArray(list), 'Directory listing should be an array');
          assert(list.length > 0, 'Directory should contain files');

          // Check for properly decoded GBK filenames
          const gbkFiles = list.filter((item) => {
            // Look for Chinese characters that indicate proper GBK decoding
            return /[\u4e00-\u9fff]/.test(item.filename);
          });

          assert(gbkFiles.length > 0,
                 'Should find GBK encoded filenames with Chinese characters');

done();
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
      encode: 'gbk',
      readyTimeout: 5000,
    });
  });

  await t.test('SFTP create file with GBK encoding', (t, done) => {
    const client = new Client();
    const privateKey = fs.readFileSync(KEY_PATH);
    const testFileName = '测试文件.txt'; // Chinese filename
    const testFilePath = path.posix.join(TEST_PATH, testFileName);
    const testContent = 'Hello, GBK encoded file!';

    // Set timeout for test
    const timeout = setTimeout(() => {
      client.end();
      done(new Error('SFTP create file operation timed out'));
    }, 15000);

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          return done(err);
        }

        // Create and write to file
        sftp.open(testFilePath, 'w', (err, handle) => {
          if (err) {
            clearTimeout(timeout);
            client.end();
            return done(err);
          }

          sftp.write(handle, Buffer.from(testContent), 0, testContent.length, 0, (err) => {
            if (err) {
              sftp.close(handle, () => {});
              clearTimeout(timeout);
              client.end();
              return done(err);
            }

            sftp.close(handle, (err) => {
              if (err) {
                clearTimeout(timeout);
                client.end();
                return done(err);
              }

              // Verify file was created by listing directory
              sftp.readdir(TEST_PATH, (err, list) => {
                clearTimeout(timeout);
                client.end();

                if (err) return done(err);

                const createdFile = list.find(item => item.filename === testFileName);
                assert(createdFile, `Created file ${testFileName} should be in directory listing`);

                console.log(`Successfully created file: ${testFileName}`);
                done();
              });
            });
          });
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
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
      encode: 'gbk',
      readyTimeout: 5000,
    });
  });

  await t.test('SFTP delete file with GBK encoding', (t, done) => {
    const client = new Client();
    const privateKey = fs.readFileSync(KEY_PATH);
    const testFileName = '测试文件.txt'; // Chinese filename
    const testFilePath = path.posix.join(TEST_PATH, testFileName);

    // Set timeout for test
    const timeout = setTimeout(() => {
      client.end();
      done(new Error('SFTP delete file operation timed out'));
    }, 15000);

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          return done(err);
        }

        // First verify file exists
        sftp.readdir(TEST_PATH, (err, list) => {
          if (err) {
            clearTimeout(timeout);
            client.end();
            return done(err);
          }

          const fileExists = list.some(item => item.filename === testFileName);
          if (!fileExists) {
            clearTimeout(timeout);
            client.end();
            return done(new Error(`Test file ${testFileName} does not exist for deletion test`));
          }

          // Delete the file
          sftp.unlink(testFilePath, (err) => {
            if (err) {
              clearTimeout(timeout);
              client.end();
              return done(err);
            }

            // Verify file was deleted by listing directory
            sftp.readdir(TEST_PATH, (err, list) => {
              clearTimeout(timeout);
              client.end();

              if (err) return done(err);

              const fileStillExists = list.some(item => item.filename === testFileName);
              assert(!fileStillExists, `Deleted file ${testFileName} should not be in directory listing`);

              console.log(`Successfully deleted file: ${testFileName}`);
              done();
            });
          });
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
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
      encode: 'gbk',
      readyTimeout: 5000,
    });
  });
});

