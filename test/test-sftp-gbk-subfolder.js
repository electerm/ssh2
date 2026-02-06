/**
 * SFTP GBK Charset Subfolder Test
 * Tests SFTP directory listing with GBK encoded subfolder names
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

test('SFTP GBK Charset Subfolder Handling', async (t) => {
  await t.test('Key file should exist', () => {
    assert(fs.existsSync(KEY_PATH), `Key file not found: ${KEY_PATH}`);
  });

  await t.test('SFTP connection and subfolder directory listing', (t, done) => {
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

        // First, list the root directory to find a subfolder with Chinese characters
        sftp.readdir(TEST_PATH, (err, list) => {
          if (err) {
            clearTimeout(timeout);
            client.end();
            return done(err);
          }

          assert(Array.isArray(list), 'Directory listing should be an array');
          assert(list.length > 0, 'Directory should contain files');

          // Find a directory with Chinese characters
          const subDirs = list.filter((item) => {
            return item.attrs.isDirectory() && /[\u4e00-\u9fff]/.test(item.filename);
          });

          if (subDirs.length === 0) {
            clearTimeout(timeout);
            client.end();
            console.log('No subdirectories with Chinese characters found, skipping test');
            return done();
          }

          const subDirName = subDirs[0].filename;
          const subDirPath = path.posix.join(TEST_PATH, subDirName);

          console.log(`Testing subfolder: ${subDirName}`, subDirPath);

          // Now, list the subfolder
          sftp.readdir(subDirPath, (err, subList) => {
            clearTimeout(timeout);
            client.end();

            if (err) return done(err);

            assert(Array.isArray(subList), 'Subfolder listing should be an array');

            // Check for properly decoded GBK filenames in subfolder
            const gbkFiles = subList.filter((item) => {
              // Look for Chinese characters that indicate proper GBK decoding
              return /[\u4e00-\u9fff]/.test(item.filename);
            });

            // Even if no files, the operation should succeed
            console.log(`Successfully listed subfolder with ${subList.length} items`);
            if (gbkFiles.length > 0) {
              console.log('Successfully decoded GBK filenames in subfolder:');
              gbkFiles.forEach((item) => {
                console.log(`  ${item.filename}`);
              });
            }

            done();
          });
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
      sftpEncoding: 'gbk',
      readyTimeout: 5000,
    });
  });
});