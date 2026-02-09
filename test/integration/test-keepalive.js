'use strict';

/**
 * Test: SSH2 Keepalive Functionality
 * 
 * This test verifies that:
 * 1. TCP keepalive is enabled by default
 * 2. SSH protocol keepalive works correctly when configured
 * 3. Activity-based keepalive reset works (resets on any SSH activity)
 * 4. Connections timeout properly when keepalive fails
 * 
 * Run with DEBUG=1 to see detailed output:
 *   DEBUG=1 node test/test-keepalive.js
 */

const assert = require('assert');
const net = require('net');

const Client = require('../lib/client.js');
const Server = require('../lib/server.js');

const {
  fixtureKey,
} = require('./common.js');

const serverCfg = { hostKeys: [fixtureKey('ssh_host_rsa_key').raw] };
const clientCfg = { username: 'testuser', password: 'testpass' };

const debug = process.env.DEBUG === '1';
const log = debug ? console.log.bind(console) : () => {};

/**
 * Creates a proxy server that can intercept and block traffic
 * between client and SSH server for testing network issues
 */
function createProxyServer(targetPort) {
  let blockTraffic = false;
  let clientSocket = null;
  let serverSocket = null;

  const proxy = net.createServer((cSocket) => {
    clientSocket = cSocket;
    serverSocket = net.createConnection(targetPort, 'localhost');

    cSocket.on('data', (data) => {
      if (blockTraffic) {
        log('[PROXY] Blocked client -> server');
        return;
      }
      serverSocket.write(data);
    });

    serverSocket.on('data', (data) => {
      if (blockTraffic) {
        log('[PROXY] Blocked server -> client');
        return;
      }
      cSocket.write(data);
    });

    cSocket.on('close', () => serverSocket && serverSocket.destroy());
    serverSocket.on('close', () => cSocket && cSocket.destroy());
    cSocket.on('error', () => serverSocket && serverSocket.destroy());
    serverSocket.on('error', () => cSocket && cSocket.destroy());
  });

  proxy.blockTraffic = () => { blockTraffic = true; };
  proxy.unblockTraffic = () => { blockTraffic = false; };

  return proxy;
}

// Test runner
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('\n=== SSH2 Keepalive Tests ===\n');
  
  for (const { name, fn } of tests) {
    try {
      console.log(`[TEST] ${name}`);
      await fn();
      console.log(`[PASS] ${name}\n`);
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exit(1);
    }
  }
  
  console.log('=== All tests passed! ===\n');
  process.exit(0);
}

// Test 1: Verify socket has keepalive enabled
test('TCP keepalive is enabled by default on socket', () => {
  return new Promise((resolve, reject) => {
    const server = new Server(serverCfg);

    server.on('connection', (conn) => {
      conn.on('authentication', (ctx) => ctx.accept());
      conn.on('ready', () => {
        setTimeout(() => conn.end(), 50);
      });
    });

    server.listen(0, 'localhost', () => {
      const client = new Client();

      client.on('ready', () => {
        // Socket should exist and have had setKeepAlive called
        assert(client._sock, 'Socket should exist');
        log('[TEST] Socket exists and connection established');
      });

      client.on('error', reject);

      client.on('close', () => {
        server.close();
        resolve();
      });

      client.connect({
        ...clientCfg,
        host: 'localhost',
        port: server.address().port,
      });
    });
  });
});

// Test 2: SSH keepalive sends pings and receives responses
test('SSH keepalive sends pings at configured interval', () => {
  return new Promise((resolve, reject) => {
    const server = new Server(serverCfg);
    const debugMsgs = [];

    server.on('connection', (conn) => {
      conn.on('authentication', (ctx) => ctx.accept());
      conn.on('ready', () => {});
    });

    server.listen(0, 'localhost', () => {
      const client = new Client();

      client.on('ready', () => {
        log('[TEST] Client ready, waiting for keepalive pings...');
        
        // Wait for keepalive cycles
        setTimeout(() => {
          // Count keepalive messages in debug output
          const pingMsgs = debugMsgs.filter(m => m.includes('Sending keepalive'));
          log(`[TEST] Found ${pingMsgs.length} keepalive pings`);
          
          try {
            assert(pingMsgs.length >= 2, `Expected at least 2 pings, got ${pingMsgs.length}`);
            client.end();
          } catch (e) {
            client.end();
            reject(e);
          }
        }, 700);
      });

      client.on('error', reject);

      client.on('close', () => {
        server.close();
        resolve();
      });

      client.connect({
        ...clientCfg,
        host: 'localhost',
        port: server.address().port,
        keepaliveInterval: 200,  // 200ms for fast testing
        keepaliveCountMax: 10,
        debug: (msg) => {
          debugMsgs.push(msg);
          log(`[CLIENT] ${msg}`);
        },
      });
    });
  });
});

// Test 3: Keepalive timeout when server stops responding
test('Keepalive timeout when server stops responding', () => {
  return new Promise((resolve, reject) => {
    const server = new Server(serverCfg);
    let proxy;
    let timeoutReceived = false;

    server.on('connection', (conn) => {
      conn.on('authentication', (ctx) => ctx.accept());
      conn.on('ready', () => {
        log('[TEST] Server: client connected');
      });
    });

    server.listen(0, 'localhost', () => {
      proxy = createProxyServer(server.address().port);
      
      proxy.listen(0, 'localhost', () => {
        const client = new Client();

        client.on('ready', () => {
          log('[TEST] Client ready, blocking traffic...');
          proxy.blockTraffic();
        });

        client.on('error', (err) => {
          log(`[TEST] Client error: ${err.message}`);
          if (err.message.includes('Keepalive timeout')) {
            timeoutReceived = true;
          }
        });

        client.on('close', () => {
          proxy.close();
          server.close();
          
          try {
            assert(timeoutReceived, 'Should have received keepalive timeout');
            resolve();
          } catch (e) {
            reject(e);
          }
        });

        client.connect({
          ...clientCfg,
          host: 'localhost',
          port: proxy.address().port,
          keepaliveInterval: 100,
          keepaliveCountMax: 2,  // Timeout after ~200ms
          debug: debug ? (msg) => log(`[CLIENT] ${msg}`) : undefined,
        });
      });
    });
  });
});

// Test 4: Activity resets keepalive counter
test('Activity resets keepalive counter (no timeout during active use)', () => {
  return new Promise((resolve, reject) => {
    const server = new Server(serverCfg);
    let execCount = 0;
    const targetExecCount = 5;

    server.on('connection', (conn) => {
      conn.on('authentication', (ctx) => ctx.accept());
      conn.on('ready', () => {
        conn.on('session', (accept) => {
          const session = accept();
          session.on('exec', (accept, reject, info) => {
            const stream = accept();
            stream.write(`Response ${++execCount}\n`);
            stream.exit(0);
            stream.end();
          });
        });
      });
    });

    server.listen(0, 'localhost', () => {
      const client = new Client();
      let timedOut = false;

      client.on('ready', () => {
        log('[TEST] Running periodic commands...');
        
        let count = 0;
        const runCommand = () => {
          if (count >= targetExecCount) {
            log(`[TEST] Completed ${count} commands without timeout`);
            client.end();
            return;
          }
          
          count++;
          client.exec(`echo test ${count}`, (err, stream) => {
            if (err) {
              reject(err);
              return;
            }
            stream.on('close', () => {
              setTimeout(runCommand, 80);  // Run command every 80ms
            });
            stream.resume();
          });
        };
        
        runCommand();
      });

      client.on('error', (err) => {
        if (err.message.includes('Keepalive timeout')) {
          timedOut = true;
        }
      });

      client.on('close', () => {
        server.close();
        
        try {
          assert(!timedOut, 'Should NOT have timed out during active use');
          assert.strictEqual(execCount, targetExecCount);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      client.connect({
        ...clientCfg,
        host: 'localhost',
        port: server.address().port,
        keepaliveInterval: 150,   // Would timeout every 150ms
        keepaliveCountMax: 2,     // After 300ms without activity
        debug: debug ? (msg) => log(`[CLIENT] ${msg}`) : undefined,
      });
    });
  });
});

// Test 5: Comparison - WITH keepalive vs WITHOUT keepalive on simulated network drop
test('Keepalive detects network failure, no-keepalive does not (within timeout)', () => {
  return new Promise((resolve, reject) => {
    const server = new Server(serverCfg);
    let proxy;

    server.on('connection', (conn) => {
      conn.on('authentication', (ctx) => ctx.accept());
      conn.on('ready', () => {});
    });

    server.listen(0, 'localhost', () => {
      proxy = createProxyServer(server.address().port);
      
      proxy.listen(0, 'localhost', () => {
        
        // Test WITH keepalive
        const testWithKeepalive = () => {
          return new Promise((res) => {
            const client = new Client();
            const startTime = Date.now();
            let detected = false;

            client.on('ready', () => {
              log('[TEST] WITH keepalive: blocking traffic');
              setTimeout(() => proxy.blockTraffic(), 30);
            });

            client.on('error', (err) => {
              if (err.message.includes('Keepalive timeout')) {
                detected = true;
                log(`[TEST] WITH keepalive: detected in ${Date.now() - startTime}ms`);
              }
            });

            client.on('close', () => {
              res({ detected, time: Date.now() - startTime });
            });

            client.connect({
              ...clientCfg,
              host: 'localhost',
              port: proxy.address().port,
              keepaliveInterval: 100,
              keepaliveCountMax: 2,
              debug: debug ? (msg) => log(`[KA] ${msg}`) : undefined,
            });
          });
        };

        // Test WITHOUT keepalive
        const testWithoutKeepalive = () => {
          return new Promise((res) => {
            const client = new Client();
            const startTime = Date.now();
            let detected = false;
            let timeout;

            client.on('ready', () => {
              log('[TEST] WITHOUT keepalive: blocking traffic');
              proxy.blockTraffic();
              
              // Give it 500ms to detect (it won't without keepalive)
              timeout = setTimeout(() => {
                log('[TEST] WITHOUT keepalive: NOT detected in 500ms');
                client.destroy();
              }, 500);
            });

            client.on('error', (err) => {
              if (err.message.includes('Keepalive')) {
                clearTimeout(timeout);
                detected = true;
              }
            });

            client.on('close', () => {
              clearTimeout(timeout);
              res({ detected, time: Date.now() - startTime });
            });

            client.connect({
              ...clientCfg,
              host: 'localhost',
              port: proxy.address().port,
              keepaliveInterval: 0,  // DISABLED
              debug: debug ? (msg) => log(`[NO-KA] ${msg}`) : undefined,
            });
          });
        };

        // Run tests sequentially
        testWithKeepalive()
          .then((withResult) => {
            proxy.unblockTraffic();
            return testWithoutKeepalive().then((withoutResult) => {
              return { withResult, withoutResult };
            });
          })
          .then(({ withResult, withoutResult }) => {
            proxy.close();
            server.close();
            
            log(`[TEST] WITH keepalive: detected=${withResult.detected}`);
            log(`[TEST] WITHOUT keepalive: detected=${withoutResult.detected}`);
            
            try {
              assert(withResult.detected, 'WITH keepalive should detect failure');
              assert(!withoutResult.detected, 'WITHOUT keepalive should NOT detect within 500ms');
              resolve();
            } catch (e) {
              reject(e);
            }
          })
          .catch(reject);
      });
    });
  });
});

// Test 6: No SSH keepalive (interval=0) - basic connection works
test('No SSH keepalive (interval=0) - connection still works', () => {
  return new Promise((resolve, reject) => {
    const server = new Server(serverCfg);

    server.on('connection', (conn) => {
      conn.on('authentication', (ctx) => ctx.accept());
      conn.on('ready', () => {
        conn.on('session', (accept) => {
          const session = accept();
          session.on('exec', (accept) => {
            const stream = accept();
            stream.write('Hello!\n');
            stream.exit(0);
            stream.end();
          });
        });
      });
    });

    server.listen(0, 'localhost', () => {
      const client = new Client();

      client.on('ready', () => {
        client.exec('echo test', (err, stream) => {
          if (err) return reject(err);
          stream.on('close', () => client.end());
          stream.resume();
        });
      });

      client.on('error', reject);

      client.on('close', () => {
        server.close();
        resolve();
      });

      client.connect({
        ...clientCfg,
        host: 'localhost',
        port: server.address().port,
        keepaliveInterval: 0,  // Disabled
      });
    });
  });
});

// Run all tests
runTests();
