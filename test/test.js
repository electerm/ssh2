'use strict';

const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const { join } = require('path');

function runTests(dir) {
  const files = readdirSync(dir).sort();
  for (const filename of files) {
    if (filename.startsWith('test-')) {
      const path = join(dir, filename);
      console.log(`> Running ${filename} ...`);
      const result = spawnSync(`${process.argv0} ${path}`, {
        shell: true,
        stdio: 'inherit',
        windowsHide: true
      });
      if (result.status !== 0)
        process.exitCode = 1;
    }
  }
}

runTests(__dirname);
runTests(join(__dirname, 'integration'));
