import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { MacOSLineAutomation } from './macos-line-automation.js';
import { WindowsLineAutomation } from './windows-line-automation.js';

export class LineAutomation {
  constructor() {
    this.platform = process.platform;
        
    if (this.platform === 'darwin') {
      this.automation = new MacOSLineAutomation();
    } else if (this.platform === 'win32') {
      this.automation = new WindowsLineAutomation();
    } else {
      throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  async switchToEnglish() {
    return await this.automation.switchToEnglish();
  }

  async selectChat(chatName) {
    return await this.automation.selectChat(chatName);
  }

  async copyAllChatToClipboard() {
    return await this.automation.copyAllChatToClipboard();
  }

  async pageUp(times = 2) {
    return await this.automation.pageUp(times);
  }

  async getChatHistory(chatName, date, messageLimit = 100, pageUpTimes = 10) {
    await this.automation.switchToEnglish();
    await this.automation.activateLine();
    const ok = await this.automation.selectChat(chatName);
    if (!ok) throw new Error(`Chat "${chatName}" not found`);

    await this.automation.pageUp(pageUpTimes);
    const chatHistory = await this.automation.copyAllChatToClipboard();

    if (process.env.CHAT_LOG_ON === 'true') {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeChatName = chatName.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_');
        const fileName = `${safeChatName}_${timestamp}.txt`;
        const logDir = process.env.CHAT_LOG_PATH || path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logFilePath = path.join(logDir, fileName);
        fs.writeFileSync(logFilePath, chatHistory);
        console.error(`Chat history saved to ${logFilePath}`);
      } catch (error) {
        console.error('Failed to write chat history to log file:', error);
      }
    }
    return chatHistory;
  }

  async sendChatMessage(chatName, message, autoSend = false) {
    await this.automation.switchToEnglish();
    await this.automation.activateLine();
    const ok = await this.automation.selectChat(chatName);
    if (!ok) throw new Error(`Chat "${chatName}" not found`);
    return await this.automation.sendMessage(chatName, message, autoSend);
  }

  async getChatList(includeGroups = true, includeIndividual = true) {
    return await this.automation.getChatList(includeGroups, includeIndividual);
  }

  async isLineRunning() {
    return await this.automation.isLineRunning();
  }

  async activateLine() {
    return await this.automation.activateLine();
  }

  async saveChatHistory(chatName, savePath, groupDir, maxPageUps = 30) {
    await this.automation.switchToEnglish();
    await this.automation.activateLine();

    const searchName = chatName.replace(/^\[LINE\]/, '');
    const ok = await this.automation.selectChat(searchName);
    if (!ok) throw new Error(`Chat "${searchName}" not found`);

    // Clear search overlay left by selectChat
    await this.automation.osa('tell application "System Events" to key code 53');
    await new Promise(r => setTimeout(r, 1000));

    const scrolled = await this.automation.scrollToLoadHistory(groupDir, maxPageUps);

    const exportStartTime = Date.now();
    let menuBounds;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        menuBounds = await this.automation.openDotMenu();
        await this.automation.clickSaveChat(menuBounds);
        break;
      } catch (e) {
        if (attempt === 1) throw e;
        await this.automation.resetToMainWindow();
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const fileName = await this.automation.handleSaveDialog(savePath);
    const filePath = savePath.endsWith('/') ? savePath + fileName : savePath + '/' + fileName;
    const result = await this.automation.waitForFileComplete(filePath, 30000, exportStartTime);
    return { ...result, scrolled };
  }

  async exportAllByClickThrough(savePath, maxPageUps = 30, cooldownMs = 3000) {
    await this.automation.switchToEnglish();
    await this.automation.activateLine();

    const listBounds = await this.automation.getChatListBounds();
    await this.automation.scrollChatListToTop(listBounds);
    const exportedNames = new Set();
    const results = [];
    const maxPages = 10;
    let pagesWithoutNew = 0;

    for (let page = 0; page <= maxPages; page++) {
      let newExportsThisPage = 0;

      for (let i = 0; i < listBounds.visibleItems; i++) {
        await this.automation.clickChatItem(listBounds, i);

        // Peek: read filename via save dialog, then cancel
        let peekedName;
        try {
          const peekMenu = await this.automation.openDotMenu();
          await this.automation.clickSaveChat(peekMenu);
          peekedName = await this.automation.readSaveDialogFilename();
          await this.automation.cancelSaveDialog();
        } catch (e) {
          try { await this.automation.resetToMainWindow(); } catch {}
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        if (exportedNames.has(peekedName)) {
          try { await this.automation.resetToMainWindow(); } catch {}
          await new Promise(r => setTimeout(r, 300));
          continue;
        }

        // New chat: scroll history, then save
        const groupDir = path.join(savePath, peekedName.replace(/\.txt$/, ''));
        try {
          const scrolled = await this.automation.scrollToLoadHistory(groupDir, maxPageUps);

          const exportStartTime = Date.now();
          let menuBounds;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              menuBounds = await this.automation.openDotMenu();
              await this.automation.clickSaveChat(menuBounds);
              break;
            } catch (e) {
              if (attempt === 1) throw e;
              await this.automation.resetToMainWindow();
              await new Promise(r => setTimeout(r, 500));
            }
          }

          const fileName = await this.automation.handleSaveDialog(savePath);
          const filePath = savePath.endsWith('/') ? savePath + fileName : savePath + '/' + fileName;
          const result = await this.automation.waitForFileComplete(filePath, 30000, exportStartTime);

          exportedNames.add(peekedName);
          results.push({ fileName, status: 'ok', ...result, scrolled });
          newExportsThisPage++;
        } catch (e) {
          results.push({ fileName: peekedName, status: 'fail', error: e.message });
        }

        try { await this.automation.resetToMainWindow(); } catch {}
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      if (newExportsThisPage > 0) {
        pagesWithoutNew = 0;
      } else {
        pagesWithoutNew++;
        if (pagesWithoutNew >= 3) break;
      }

      if (page < maxPages) {
        await this.automation.scrollChatList(listBounds);
      }
    }

    return results;
  }
}