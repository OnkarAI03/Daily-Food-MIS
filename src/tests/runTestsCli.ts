/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI & CI Test Runner for Daily Food MIS
 * Executes all Unit, Integration, and Security tests and exits with code 1 if any test fails.
 */

import { runAllAutomatedTests } from '../domain/testSuiteRunner';

const report = runAllAutomatedTests('CI-CLI-VERIFICATION');

console.log('==============================================================');
console.log(`DAILY FOOD MIS — AUTOMATED TEST SUITE (${report.runId})`);
console.log(`Executed At: ${report.executedAtUtc} | Duration: ${report.durationMs}ms`);
console.log('==============================================================');

for (const res of report.results) {
  const badge = res.status === 'passed' ? '[PASS]' : '[FAIL]';
  console.log(`${badge} [${res.suite}] ${res.id}: ${res.name} (${res.assertionCount} assertions)`);
  if (res.status !== 'passed') {
    console.error(`   -> Error: ${res.details}`);
  }
}

console.log('--------------------------------------------------------------');
console.log(
  `Summary: ${report.passed}/${report.totalTests} passed, ${report.failed} failed, ${report.skipped} skipped.`
);

if (report.failed > 0) {
  process.exit(1);
}
