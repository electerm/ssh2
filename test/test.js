'use strict';

const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const { join } = require('path');

function runTests(dir) {
  const files = readdirSync(dir).sort();
  const results = { passed: [], failed: [] };

  for (const filename of files) {
    if (filename.startsWith('test-')) {
      const path = join(dir, filename);
      console.log(`> Running ${filename} ...`);
      const result = spawnSync(`${process.argv0} ${path}`, {
        shell: true,
        stdio: 'inherit',
        windowsHide: true
      });
      if (result.status !== 0) {
        results.failed.push(filename);
      } else {
        results.passed.push(filename);
      }
    }
  }

  return results;
}

const allResults = { passed: [], failed: [] };

function merge(r) {
  allResults.passed.push(...r.passed);
  allResults.failed.push(...r.failed);
}

merge(runTests(__dirname));
// merge(runTests(join(__dirname, 'integration')));

const total = allResults.passed.length + allResults.failed.length;
console.log('');
console.log('='.repeat(50));
console.log(`Test Results: ${allResults.passed.length}/${total} passed`);
if (allResults.failed.length > 0) {
  console.log(`FAILED (${allResults.failed.length}):`);
  for (const f of allResults.failed)
    console.log(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log('All tests passed.');
}
console.log('='.repeat(50));
