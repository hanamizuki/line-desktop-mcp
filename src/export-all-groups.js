#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { LineAutomation } from './automation/line-automation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf8'));
const savePath = config.savePath.replace(/^~/, os.homedir());
const primaryOnly = process.argv.includes('--primary');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pgrepRunning(name) {
  try {
    execSync(`pgrep -x ${name}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function getGroups() {
  if (primaryOnly) return [config.primaryGroup];
  if (!fs.existsSync(savePath)) {
    log(`ERROR: savePath does not exist: ${savePath}`);
    process.exit(1);
  }
  return fs.readdirSync(savePath, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('[LINE]'))
    .map(e => e.name)
    .filter(n => !(config.exclude || []).includes(n));
}

async function preflight(automation) {
  if (!pgrepRunning('LINE')) throw new Error('LINE is not running');
  if (!pgrepRunning('WindowServer')) throw new Error('No GUI session (WindowServer missing)');
  try {
    await automation.automation.getWindowBounds();
  } catch (e) {
    throw new Error(`Cannot access LINE window: ${e.message}`);
  }
}

async function main() {
  const mode = primaryOnly ? 'primary only' : 'all groups';
  log(`=== LINE Export (${mode}) ===`);
  log(`savePath: ${savePath}`);

  fs.mkdirSync(savePath, { recursive: true });

  const automation = new LineAutomation();
  log('Running preflight...');
  await preflight(automation);
  log('Preflight OK');

  const groups = getGroups();
  log(`Groups to export: ${groups.length}`);
  if (groups.length === 0) { log('Nothing to export.'); process.exit(0); }

  const results = [];

  for (const group of groups) {
    const groupDir = path.join(savePath, group);
    log(`--- ${group} ---`);
    try {
      const result = await automation.saveChatHistory(group, savePath, groupDir, config.maxPageUps || 30);
      log(`OK: ${result.fileName} (${result.fileSize} bytes, ${result.lineCount} lines, scrolled ${result.scrolled} pages)`);
      results.push({ group, status: 'ok', ...result });
    } catch (e) {
      log(`FAIL: ${e.message}`);
      results.push({ group, status: 'fail', error: e.message });
    } finally {
      try { await automation.automation.resetToMainWindow(); } catch {}
      await sleep(config.cooldownMs || 3000);
    }
  }

  log('=== Summary ===');
  const ok = results.filter(r => r.status === 'ok').length;
  const fail = results.filter(r => r.status === 'fail').length;
  log(`OK: ${ok}, FAIL: ${fail}, TOTAL: ${results.length}`);
  for (const r of results) {
    if (r.status === 'fail') log(`  FAIL: ${r.group} — ${r.error}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
