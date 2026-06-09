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

function pgrepRunning(name) {
  try {
    execSync(`pgrep -x ${name}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

async function preflight(automation) {
  if (!pgrepRunning('LINE')) throw new Error('LINE is not running');
  if (!pgrepRunning('WindowServer')) throw new Error('No GUI session (WindowServer missing)');
  try {
    await automation.automation.getWindowBounds();
  } catch (e) {
    throw new Error(`Cannot access LINE window: ${e.message}`);
  }
  if (await automation.automation.dismissLingeringSheets()) {
    log('Preflight: dismissed lingering sheet/dialog from previous run');
  }
}

async function main() {
  const mode = primaryOnly ? 'primary only' : 'all chats (click-through)';
  log(`=== LINE Export (${mode}) ===`);
  log(`savePath: ${savePath}`);

  fs.mkdirSync(savePath, { recursive: true });

  const automation = new LineAutomation();
  log('Running preflight...');
  await preflight(automation);
  log('Preflight OK');

  let results;

  if (primaryOnly) {
    const group = config.primaryGroup;
    const groupDir = path.join(savePath, group);
    log(`--- ${group} ---`);
    try {
      const result = await automation.saveChatHistory(group, savePath, groupDir, config.maxPageUps || 30);
      log(`OK: ${result.fileName} (${result.fileSize} bytes, ${result.lineCount} lines, scrolled ${result.scrolled} pages)`);
      results = [{ name: group, status: 'ok', ...result }];
    } catch (e) {
      log(`FAIL: ${e.message}`);
      results = [{ name: group, status: 'fail', error: e.message }];
    }
  } else {
    log('Starting click-through export of all chats...');
    results = await automation.exportAllByClickThrough(
      savePath,
      config.maxPageUps || 30,
      config.cooldownMs || 3000
    );
    for (const r of results) {
      if (r.status === 'ok') {
        log(`OK: ${r.fileName} (${r.fileSize} bytes, ${r.lineCount} lines, scrolled ${r.scrolled} pages)`);
      } else {
        log(`FAIL: ${r.fileName || '?'} — ${r.error}`);
      }
    }
  }

  log('=== Summary ===');
  const ok = results.filter(r => r.status === 'ok').length;
  const fail = results.filter(r => r.status === 'fail').length;
  log(`OK: ${ok}, FAIL: ${fail}, TOTAL: ${results.length}`);
  for (const r of results) {
    if (r.status === 'fail') log(`  FAIL: ${r.fileName || r.name || '?'} — ${r.error}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
