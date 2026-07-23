'use strict';

const assert = require('assert');

const {
  mustCall,
  setupSimple,
} = require('./common.js');

const DEBUG = false;

// Stand up an in-process SSH + SFTP server, capture any `env` requests the
// client sends when starting an SFTP subsystem, and hand the connected
// client/server SFTP instances (plus the captured env) to `cb`.
function setupEnv(title, envToSend, cb) {
  const { client, server } = setupSimple(DEBUG, title);
  let clientSFTP;
  let serverSFTP;
  const receivedEnv = {};

  const onSFTP = mustCall(() => {
    if (clientSFTP && serverSFTP)
      cb(clientSFTP, serverSFTP, receivedEnv);
  }, 2);

  client.on('ready', mustCall(() => {
    client.sftp(envToSend, mustCall((err, sftp) => {
      assert(!err, `[${title}] Unexpected client sftp start error: ${err}`);
      sftp.on('close', mustCall(() => {
        client.end();
      }));
      clientSFTP = sftp;
      onSFTP();
    }));
  }));

  server.on('connection', mustCall((conn) => {
    conn.on('ready', mustCall(() => {
      conn.on('session', mustCall((accept, reject) => {
        const session = accept();
        // Capture and accept any env requests the client sends before the
        // SFTP subsystem is opened.
        session.on('env', (acceptEnv, rejectEnv, info) => {
          receivedEnv[info.key] = info.val;
          acceptEnv();
        });
        session.on('sftp', mustCall((acceptSftp, rejectSftp) => {
          const sftp = acceptSftp();
          sftp.on('close', mustCall(() => {
            conn.end();
          }));
          serverSFTP = sftp;
          onSFTP();
        }));
      }));
    }));
  }));
}

setupEnv('sftp sends env (LANG=zh_CN.GBK)', { LANG: 'zh_CN.GBK' },
  (clientSFTP, serverSFTP, receivedEnv) => {
    assert.strictEqual(
      receivedEnv.LANG,
      'zh_CN.GBK',
      `Server should have received env LANG=zh_CN.GBK, got: ${JSON.stringify(receivedEnv)}`
    );
    clientSFTP.end();
    serverSFTP.end();
  });

setupEnv('sftp sends multiple env vars',
  { LANG: 'zh_CN.GBK', LC_ALL: 'C', MY_SFTP_ROOT: '/data' },
  (clientSFTP, serverSFTP, receivedEnv) => {
    assert.deepStrictEqual(
      receivedEnv,
      { LANG: 'zh_CN.GBK', LC_ALL: 'C', MY_SFTP_ROOT: '/data' },
      `Server should have received all env vars, got: ${JSON.stringify(receivedEnv)}`
    );
    clientSFTP.end();
    serverSFTP.end();
  });

setupEnv('sftp without env sends nothing', undefined,
  (clientSFTP, serverSFTP, receivedEnv) => {
    assert.deepStrictEqual(
      receivedEnv,
      {},
      `No env should be received when none is sent, got: ${JSON.stringify(receivedEnv)}`
    );
    clientSFTP.end();
    serverSFTP.end();
  });
