'use strict';

// Test for verifying the SFTP large header fix described in
// https://github.com/mscdex/ssh2/issues/1048#issuecomment-2110148714
//
// This test connects to a Docker container with a .bashrc that outputs
// a large amount of text, verifying that the fix properly handles
// text output that would otherwise interfere with SFTP protocol parsing.

const assert = require('assert');
const Client = require('../../lib/client.js');

const HOST = 'localhost';
const PORT = 23332;
const USERNAME = 'root';
const PASSWORD = 'root';

console.log('Testing SFTP large header issue...');

const client = new Client();

client.on('ready', function() {
  console.log('SSH connection established');

  client.sftp(function(err, sftp) {
    if (err) {
      console.log('✗ Unexpected SFTP error:', err.message);
      process.exit(1);
    } else {
      console.log('✓ SFTP initialized successfully despite large header output');
      // Try a simple operation to confirm it works
      sftp.readdir('/', function(err, list) {
        if (err) {
          console.log('✗ SFTP readdir failed:', err.message);
          process.exit(1);
        } else {
          console.log('✓ SFTP readdir successful, directory listing:', list.length, 'items');
          client.end();
          process.exit(0);
        }
      });
    }
  });
});

console.log(`Connecting to ${HOST}:${PORT} as ${USERNAME}...`);
client.connect({
  host: HOST,
  port: PORT,
  username: USERNAME,
  password: PASSWORD,
  // Disable strict host key checking for test
  hostVerifier: function() { return true; },
  // Increase ready timeout
  readyTimeout: 5000
});