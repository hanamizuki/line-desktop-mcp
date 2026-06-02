#!/usr/bin/env node
/**
 * export-all-groups.js
 * Batch-export LINE chat histories for all (or primary) groups.
 *
 * Usage:
 *   node src/export-all-groups.js           # export all groups found in savePath
 *   node src/export-all-groups.js --primary # export only config.primaryGroup
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { LineAutomation } from './automation/line-automation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────────────────────────────

const configPath = path.resolve(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const savePath = config.savePath.replace(/^~/, os.homedir());
const { primaryGroup, exclude = [], maxPageUps = 30, cooldownMs = 3000 } = config;

const primaryOnly = process.argv.includes('--primary');

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pgrepRunning(processName) {
  try {
    execSync(`pgrep -x ${processName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── Preflight ─────────────────────────────────────────────────────────────────

async function runPreflightChecks(automation) {
  if (!pgrepRunning('LINE')) {
    throw new Error('Preflight failed: LINE is not running (pgrep -x LINE found nothing)');
  }

  if (!pgrepRunning('WindowServer')) {
    throw new Error('Preflight failed: WindowServer is not running — no GUI session active');
  }

  try {
    await automation.automation.getWindowBounds();
  } catch (err) {
    throw new Error();
  }
}

// ── Group discovery ──────────────────────────────────────────────────────────

function discoverGroups() {
  if (!fs.existsSync(savePath)) {
    throw new Error();
  }

  const entries = fs.readdirSync(savePath, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && e.name.startsWith('[LINE]'))
    .map(e => e.name)
    .filter(name => !exclude.includes(name));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const automation = new LineAutomation();

  console.log('Running preflight checks…');
  await runPreflightChecks(automation);
  console.log('Preflight OK\n');

  // Build the list of groups to process
  let groups;
  if (primaryOnly) {
    groups = [primaryGroup];
    console.log();
  } else {
    groups = discoverGroups();
    console.log();
  }

  if (groups.length === 0) {
    console.log('No groups to export. Exiting.');
    process.exit(0);
  }

  const results = { ok: [], fail: [] };

  for (const groupName of groups) {
    const groupDir = path.join(savePath, groupName);
    console.log();

    try {
      const result = await automation.saveChatHistory(groupName, savePath, groupDir, maxPageUps);
      const { fileName, size, lines, scrolled } = result;
      console.log();
      results.ok.push(groupName);
    } catch (err) {
      console.error();
      results.fail.push({ groupName, error: err.message });
    } finally {
      try {
        await automation.automation.resetToMainWindow();
      } catch {
        // best-effort reset
      }
      await sleep(cooldownMs);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══ Summary ═══');
  console.log();
  console.log();
  if (results.fail.length > 0) {
    console.log('\nFailed groups:');
    for (const { groupName, error } of results.fail) {
      console.log();
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
