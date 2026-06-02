// macos-line-automation.js
import applescript from 'applescript';
import { execSync } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

const execAppleScript = promisify(applescript.execString);

function resolveCliclickPath() {
  const envPath = process.env.CLICLICK_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const pathEnv = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
  try {
    const p = execSync('which cliclick', {
      encoding: 'utf8',
      env: { ...process.env, PATH: pathEnv },
    })
      .trim()
      .split('\n')[0];
    if (p && fs.existsSync(p)) return p;
  } catch {
    // fall through
  }
  for (const c of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'cliclick not found. Install with: brew install cliclick, or set CLICLICK_PATH to the binary.'
  );
}

export class MacOSLineAutomation {
  constructor() {
    this.lineAppName = 'LINE';
    this.lineProcessName = 'LINE';
    this.delayShort = 0.15; // 秒
    this.delayMid = 0.35;
    this.delayLong = 3;
    this.cliclickPath = resolveCliclickPath();
  }

  /** AppleScript：以 quoted form 安全呼叫 cliclick（cxVar/cyVar 為 AppleScript 變數名） */
  cliclickShellClick(cxVar, cyVar) {
    return `do shell script (quoted form of "${this.appleEsc(this.cliclickPath)}") & " c:" & ${cxVar} & "," & ${cyVar}`;
  }

  // -------- 小工具 --------
  appleEsc(s = '') {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  async osa(script) {
    const res = await execAppleScript(script);
    return (typeof res === 'string' ? res : '').trim();
  }

  async hasAccessibilityPermission() {
    const script = `
      tell application "System Events"
        set _ to UI elements enabled
        return _ as boolean
      end tell
    `;
    try {
      const r = await execAppleScript(script);
      return String(r) === 'true';
    } catch {
      return false;
    }
  }

  // -------- 基礎控制 --------
  async isLineRunning() {
    try {
      const script = `
        tell application "System Events"
          return (name of processes) contains "${this.appleEsc(this.lineProcessName)}"
        end tell
      `;
      const result = await this.osa(script);
      return result === 'true';
    } catch {
      return false;
    }
  }

  // -------- 啟動 LINE --------
  async activateLine() {
    // Use direct application name instead of passing as parameter
    const script = `
      tell application "${this.appleEsc(this.lineAppName)}"
        activate
      end tell

      -- 檢查是否成功成為前景
      tell application "System Events"
          repeat with i from 1 to 3
              if frontmost of process "${this.appleEsc(this.lineAppName)}" is true then
                  exit repeat
              else
                  delay 0.5
                  tell application "${this.appleEsc(this.lineAppName)}" to activate
              end if
          end repeat
      end tell

      -- 檢查是否超過重試次數
      tell application "System Events"
          if frontmost of process "${this.appleEsc(this.lineAppName)}" is false then
              error "無法將 LINE 置於前景。"
          end if
      end tell

    `;
    try {
      await execAppleScript(script);
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  // -------- 進入指定聊天室 --------
  async selectChat(chatName) {

    const script = `
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"

         set the clipboard to "${this.appleEsc(chatName)}"

          -- 點擊『聊天』Icon
          try
          set the lineWin to window 1 
          on error errMsg number errNum
              if errNum is -1719 then
                  return false
              else
                  error errMsg number errNum
              end if
          end try

          -- 取得位置與大小（全域座標）
          set {xPosition, yPosition} to position of lineWin
          set {xSize, ySize} to size of lineWin

          set cx to xPosition + 32
          set cy to yPosition + 110

          ${this.cliclickShellClick('cx', 'cy')}

          delay ${this.delayMid}

          -- 點擊『搜尋』textbox
          try
          set theSearch to text field 1 of splitter group 1 of window 1 
          on error errMsg number errNum
              if errNum is -1719 then
                  return false
              else
                  error errMsg number errNum
              end if
          end try

          -- 取得位置與大小（全域座標）
          set {xPosition, yPosition} to position of theSearch
          set {xSize, ySize} to size of theSearch
          
          -- 點選正中央
          set cx to xPosition + (xSize div 2)
          set cy to yPosition + (ySize div 2)

          ${this.cliclickShellClick('cx', 'cy')}

          delay ${this.delayShort}

          -- 清空舊關鍵字
          key down command
          keystroke "a"
          key up command

          -- 輸入目標聊天室名稱並進入（使用剪貼簿處理中文）
          key down command
          keystroke "v"
          key up command
          delay ${this.delayMid}

          -- 依你原始路徑抓元素clea
          set theRow to row 2 of list 1 of splitter group 1 of window 1
          
          -- 取得位置與大小（全域座標）
          set {xPosition2, yPosition2} to position of theRow
          set {xSize2, ySize2} to size of theRow
          
          -- 點選正中央
          set cx2 to xPosition2 + (xSize2 div 2)
          set cy2 to yPosition2 + (ySize2 div 2)-15
			    
          -- 點擊進聊天室
          ${this.cliclickShellClick('cx2', 'cy2')}
          delay ${this.delayShort}
          ${this.cliclickShellClick('cx2', 'cy2')}

          delay ${this.delayLong}
        end tell
      end tell
      return true
    `;
    try {
      const r = await this.osa(script);
      return r === 'true';
    } catch (e) {
      console.error('selectChat failed', e);
      return false;
    }
  }

  // -------- 複製可選擇所有訊息到剪貼簿 --------
  async copyAllChatToClipboard() {
    const script = `
        tell application "System Events"

          tell process "${this.appleEsc(this.lineProcessName)}"

            key down command
            keystroke "a"
            key up command
            delay ${this.delayShort}

            key down command
            keystroke "c"
            key up command

     
        delay ${this.delayShort}
        set t to the clipboard
        end tell
      end tell
      return t
    `;
    
    try {
      const r = await this.osa(script);
      return r;
    } catch (e) {
      console.error('copyAllChatToClipboard failed', e);
      return null;
    }
  }

  // -------- 上捲（Page Up）--------
  async pageUp(times = 2) {
    const t = times;
    const script = `
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"
          -- 依你原始路徑抓元素
          set theRow to list 1 of splitter group 1 of splitter group 1 of window 1
          
          -- 取得位置與大小（全域座標）
          set {xPosition, yPosition} to position of theRow
          set {xSize, ySize} to size of theRow
          
          -- 點左下角
          set cx to xPosition + (xSize -20)
          set cy to yPosition + (ySize -15)
			    
          ${this.cliclickShellClick('cx', 'cy')}

          delay ${this.delayLong}

          ${this.cliclickShellClick('cx', 'cy')}
          
          repeat ${t} times
            -- 按上方向鍵回上一頁
            key code 126 -- 上方向鍵
            delay ${this.delayShort}
          end repeat
        end tell
      end tell
      return true
    `;
    await this.osa(script);
  }


  // -------- 切換輸入法到英文--------
  async switchToEnglish() {
    
    const script = `
      tell application "System Events"
        
        tell application process "TextInputMenuAgent"
          set inputMenu to menu bar item 1 of menu bar 2
          click inputMenu
          tell menu 1 of inputMenu
            if exists menu item "ABC" then
              click menu item "ABC"
            else if exists menu item "美國" then
              click menu item "美國"
            end if
          end tell
        end tell
      end tell
    `;
    
    await this.osa(script);
  }
    
  // -------- 發送訊息（剪貼簿貼上 + Enter）--------
  async sendMessage(chatName, message, autoSend = false) {
    // Split the message by @mentions (format: @xxx followed by space)
    const messageParts = [];
    let currentPart = '';
    
    // Use regex to split by @mentions pattern
    /*
    const parts = message.split(/(@\S+\s)/g);
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.match(/^@\S+\s$/)) {
        // If we have accumulated text before this @mention, add it as a separate part
        if (currentPart) {
          messageParts.push(currentPart);
          currentPart = '';
        }
        // Add the @mention as its own part
        messageParts.push(part);
      } else {
        // Accumulate non-@mention text
        currentPart += part;
      }
    }
    */
    
    // Use regex to split by @mentions pattern (已排除 /@ 這個格式)
    const parts = message.split(/((?<!\/)@\S+\s)/g);
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.match(/^(?<!\/)@\S+\s$/)) {
        // If we have accumulated text before this @mention, add it as a separate part
        if (currentPart) {
          messageParts.push(currentPart);
          currentPart = '';
        }
        // Add the @mention as its own part
        messageParts.push(part);
      } else {
        // Accumulate non-@mention text
        currentPart += part;
      }
    }

    // Add any remaining text
    if (currentPart) {
      messageParts.push(currentPart);
    }
    
    let result = await this._sendSingleMessageInit(chatName);

    // Send each part separately

    for (const part of messageParts) {

      // Special handling for @mentions
      if (part.match(/^@\S+\s$/)) {
        // 1. Send a space before the @mention
        result = await this._sendSingleMessage(chatName, ' ');

        // 2. Send the @mention
        result = await this._sendSingleMessage(chatName, part.trim()+'k');
        
        // 3. Press backspace
        result = await this._sendSingleMessageBackspace();
        
        // 4. Click @mention
        result = await this._sendSingleMessageClickMention();
        
      } else {
        // Normal text handling
        result = await this._sendSingleMessage(chatName, part);

      }
    }

    if (autoSend) {
      result = await this._sendSingleMessageEnter();
    }

    if (result.success)
      return { success: true, error: null };
    else
      return { success: false, error: result.error };
  }
  
  // Helper method to send a single message part
  async _sendSingleMessageInit(chatName) {
    // Use a safer approach: write message to clipboard via JavaScript instead of AppleScript
    const script = `
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"

          -- 依你原始路徑抓元素
          set theRow to text area 1 of splitter group 1 of splitter group 1 of window 1
          
          -- 取得位置與大小（全域座標）
          set {xPosition, yPosition} to position of theRow
          set {xSize, ySize} to size of theRow
          
          -- 點選正中央
          set cx to xPosition + (xSize div 2)
          set cy to yPosition + (ySize div 2)
          
          ${this.cliclickShellClick('cx', 'cy')}

          delay ${this.delayShort}

          key down command
          keystroke "a"
          key up command
          delay ${this.delayShort}


        end tell
      end tell
      return true
    `;
    
    try {      
      const r = await this.osa(script);
      return { success: r === 'true', error: r === 'true' ? null : 'Failed to send message' };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  // Helper method to send a single message part
  async _sendSingleMessage(chatName, message) {
    // Use a safer approach: write message to clipboard via JavaScript instead of AppleScript
    const script = `
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"

         set the clipboard to "${this.appleEsc(message)}"

          key down command
          keystroke "v"
          key up command
          delay ${this.delayMid}

        end tell
      end tell
      return true
    `;
    
    try {      
      const r = await this.osa(script);
      return { success: r === 'true', error: r === 'true' ? null : 'Failed to send message' };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
  
  // Helper method to send a single message part
  async _sendSingleMessageEnter() {
    // Use a safer approach: write message to clipboard via JavaScript instead of AppleScript
    const script = `
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"

          key down return
          delay ${this.delayShort}
          key up return

        end tell
      end tell
      return true
    `;
    
    try {      
      const r = await this.osa(script);
      return { success: r === 'true', error: r === 'true' ? null : 'Failed to send message' };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }

   // Helper method to send a single message part
   async _sendSingleMessageBackspace() {
    // Use a safer approach: write message to clipboard via JavaScript instead of AppleScript
    const script = `
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"

          -- 左刪（Backspace）
          key code 51
          delay ${this.delayMid}
        end tell
      end tell
      return true
    `;
    
    try {      
      const r = await this.osa(script);
      return { success: r === 'true', error: r === 'true' ? null : 'Failed to send message' };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }

     // Helper method to send a single message part
     async _sendSingleMessageClickMention() {
      // Use a safer approach: write message to clipboard via JavaScript instead of AppleScript
      const script = `
    tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"

          -- 依你原始路徑抓元素(文字輸入區)
          set theRow to text area 1 of splitter group 1 of splitter group 1 of window 1
          
          -- 取得位置與大小（全域座標）
          set {xPosition, yPosition} to position of theRow
          set {xSize, ySize} to size of theRow
          
          -- 點選上方 mention 清單
          set cx to xPosition + (xSize div 4)
          set cy to yPosition - 10
          
          ${this.cliclickShellClick('cx', 'cy')}

          delay ${this.delayShort}
        end tell
      end tell
      return true
      `;
      
      try {      
        const r = await this.osa(script);
        return { success: r === 'true', error: r === 'true' ? null : 'Failed to send message' };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    }
// === getWindowBounds ===
  async getWindowBounds() {
    const script = `
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"
          set bestW to missing value
          set bestArea to 0
          repeat with w in windows
            set {ww, wh} to size of w
            if ww > 200 and wh > 200 then
              set area to ww * wh
              if area > bestArea then
                set bestArea to area
                set bestW to w
              end if
            end if
          end repeat
          if bestW is missing value then set bestW to window 1
          set {xPosition, yPosition} to position of bestW
          set {xSize, ySize} to size of bestW
          return (xPosition as text) & "," & (yPosition as text) & "," & (xSize as text) & "," & (ySize as text)
        end tell
      end tell
    `;
    const r = await this.osa(script);
    const [x, y, width, height] = r.split(",").map(Number);
    return { x, y, width, height };
  }


  // === resetToMainWindow ===
  async resetToMainWindow() {
    for (let i = 0; i < 5; i++) {
      const countScript = `
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            return (count of windows) as text
          end tell
        end tell
      `;
      const count = parseInt(await this.osa(countScript), 10);
      if (count <= 1) return;

      const escScript = `
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            key code 53
          end tell
        end tell
      `;
      await this.osa(escScript);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // === openDotMenu ===
  async openDotMenu() {
    const bounds = await this.getWindowBounds();
    const dotX = bounds.x + bounds.width - 20;
    const dotY = bounds.y + 83;
    const midX = bounds.x + Math.floor(bounds.width / 2);

    for (let attempt = 0; attempt < 2; attempt++) {
      // Record window count before click
      const beforeCount = parseInt(await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            return (count of windows) as text
          end tell
        end tell
      `), 10);

      // Click the dot menu button
      execSync(`${this.cliclickPath} c:${dotX},${dotY}`);

      // Poll for new window (max 3s, every 300ms)
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 300));
        const windowInfo = await this.osa(`
          tell application "System Events"
            tell process "${this.appleEsc(this.lineProcessName)}"
              set wCount to count of windows
              if wCount > ${beforeCount} then
                set results to ""
                repeat with i from 1 to wCount
                  set w to window i
                  set {wx, wy} to position of w
                  set {ww, wh} to size of w
                  set results to results & wx & "," & wy & "," & ww & "," & wh & "|"
                end repeat
                return results
              end if
              return "none"
            end tell
          end tell
        `);

        if (windowInfo !== 'none' && windowInfo !== '') {
          // Parse all windows, find the new popup
          const windows = windowInfo.split('|').filter(s => s.length > 0);
          for (const w of windows) {
            const [wx, wy, ww, wh] = w.split(',').map(Number);
            if (wx > midX && wh > 200) {
              return { x: wx, y: wy, width: ww, height: wh };
            }
          }
        }
      }

      // First attempt failed, reset and retry
      if (attempt === 0) {
        await this.resetToMainWindow();
        await new Promise(r => setTimeout(r, 300));
      }
    }

    throw new Error('openDotMenu: no popup window appeared after 2 attempts');
  }


  // === clickSaveChat ===
  async clickSaveChat(menuBounds) {
    const clickX = menuBounds.x + 62;
    const clickY = menuBounds.y + 247;

    execSync(`${this.cliclickPath} c:${clickX},${clickY}`);

    // Poll for save sheet (max 5s, every 300ms)
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300));

      // Check if a save sheet appeared
      const sheetCheck = await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            try
              set s to sheet 1 of window 1
              set desc to description of s
              if desc contains "儲存" then
                return "sheet_ok"
              end if
              return "sheet_wrong_desc"
            on error
              -- Check if a non-sheet window appeared (wrong menu item)
              set wCount to count of windows
              if wCount > 1 then
                return "wrong_window"
              end if
              return "waiting"
            end try
          end tell
        end tell
      `);

      if (sheetCheck === 'sheet_ok') {
        return;
      }
      if (sheetCheck === 'wrong_window') {
        throw new Error('clickSaveChat: wrong menu item clicked (non-sheet window appeared)');
      }
    }

    throw new Error('clickSaveChat: save sheet did not appear within 5s');
  }

  // === handleSaveDialog ===
  async handleSaveDialog(targetPath) {
    // Read current filename
    const fileName = await this.osa(`
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"
          return value of text field "儲存為：" of splitter group 1 of sheet 1 of window 1
        end tell
      end tell
    `);

    // Check current location
    const currentLocation = await this.osa(`
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"
          return value of pop up button "位置：" of splitter group 1 of sheet 1 of window 1
        end tell
      end tell
    `);

    const targetBasename = targetPath.split('/').filter(s => s).pop();
    const currentBasename = currentLocation.split('/').filter(s => s).pop();

    if (currentBasename !== targetBasename) {
      // Press Cmd+Shift+G to open Go To Folder
      await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            key down {command, shift}
            keystroke "g"
            key up {command, shift}
          end tell
        end tell
      `);
      await new Promise(r => setTimeout(r, 500));

      // Set clipboard to targetPath and paste
      await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            set the clipboard to "${this.appleEsc(targetPath)}"
            key down command
            keystroke "a"
            key up command
            key down command
            keystroke "v"
            key up command
          end tell
        end tell
      `);
      await new Promise(r => setTimeout(r, 300));

      // Press Enter to navigate
      await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            keystroke return
          end tell
        end tell
      `);
      await new Promise(r => setTimeout(r, 500));
    }

    // Click the save button
    await this.osa(`
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"
          click button "儲存" of splitter group 1 of sheet 1 of window 1
        end tell
      end tell
    `);
    await new Promise(r => setTimeout(r, 500));

    // Try to click overwrite confirm (may not appear)
    try {
      await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            click button "取代" of sheet 1 of sheet 1 of window 1
          end tell
        end tell
      `);
    } catch {
      // No overwrite dialog, that's fine
    }

    return fileName;
  }

  // === waitForFileComplete ===
  async waitForFileComplete(filePath, timeout = 30000, startTime = Date.now()) {
    const deadline = Date.now() + timeout;
    let lastSize = -1;
    let stableCount = 0;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));

      try {
        const stat = fs.statSync(filePath);
        const currentSize = stat.size;

        if (currentSize > 0 && currentSize === lastSize && stat.mtimeMs >= startTime) {
          stableCount++;
          if (stableCount >= 2) {
            // File size stable for 2 consecutive checks
            const content = fs.readFileSync(filePath, 'utf-8');
            const lineCount = content.split('\n').length;
            const fileName = filePath.split('/').pop();
            return { filePath, fileName, fileSize: currentSize, lineCount };
          }
        } else {
          stableCount = 0;
        }
        lastSize = currentSize;
      } catch {
        // File doesn't exist yet
        lastSize = -1;
        stableCount = 0;
      }
    }

    throw new Error(`waitForFileComplete: timed out waiting for file: ${filePath}`);
  }


  // === scrollToLoadHistory ===
  async scrollToLoadHistory(groupDir, maxPageUps = 30) {
    let pageUps = maxPageUps;

    try {
      const rawDir = `${groupDir}/raw`;
      if (fs.existsSync(rawDir)) {
        const files = fs.readdirSync(rawDir)
          .filter(f => f.endsWith('.txt'))
          .sort();

        if (files.length > 0) {
          const latestFile = files[files.length - 1];
          // Extract date from filename (YYYY-MM-DD.txt)
          const dateMatch = latestFile.match(/^(\d{4}-\d{2}-\d{2})\.txt$/);
          if (dateMatch) {
            const lastDate = new Date(dateMatch[1]);
            const now = new Date();
            const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
            pageUps = Math.min(Math.max(10, (daysSince + 1) * 3), maxPageUps);
          }
        }
      }
    } catch {
      // Use maxPageUps on any error
      pageUps = maxPageUps;
    }

    await this.pageUp(pageUps);
    return pageUps;
  }

  // === getChatListBounds ===
  async getChatListBounds() {
    const itemHeight = 71;
    try {
      const r = await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            set bestW to missing value
            set bestArea to 0
            repeat with w in windows
              set {ww, wh} to size of w
              if ww > 200 and wh > 200 then
                set area to ww * wh
                if area > bestArea then
                  set bestArea to area
                  set bestW to w
                end if
              end if
            end repeat
            if bestW is missing value then set bestW to window 1
            set theList to list 1 of splitter group 1 of bestW
            set {lx, ly} to position of theList
            set {lw, lh} to size of theList
            return (lx as text) & "," & (ly as text) & "," & (lw as text) & "," & (lh as text)
          end tell
        end tell
      `);
      const [x, y, width, height] = r.split(',').map(Number);
      return { x, y, width, height, itemHeight, visibleItems: Math.floor(height / itemHeight) };
    } catch {
      const wb = await this.getWindowBounds();
      const listHeight = Math.min(718, (wb.y + wb.height) - (wb.y + 101));
      return {
        x: wb.x + 62,
        y: wb.y + 101,
        width: Math.min(456, wb.width - 62),
        height: listHeight,
        itemHeight,
        visibleItems: Math.floor(listHeight / itemHeight)
      };
    }
  }

  // === clickChatItem ===
  async clickChatItem(listBounds, index) {
    const x = listBounds.x + Math.floor(listBounds.width / 2);
    const y = listBounds.y + index * listBounds.itemHeight + Math.floor(listBounds.itemHeight / 2);
    execSync(`${this.cliclickPath} c:${x},${y}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  // === scrollChatList ===
  // === scrollChatList ===
  async scrollChatList(listBounds, down = true) {
    const x = listBounds.x + Math.floor(listBounds.width / 2);
    const y = listBounds.y + Math.floor(listBounds.height / 2);
    execSync(`${this.cliclickPath} c:${x},${y}`);
    await new Promise(r => setTimeout(r, 300));
    const delta = down ? -3 : 3;
    const swift = `import CoreGraphics; import Foundation; for _ in 0..<25 { let e = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: ${delta}, wheel2: 0, wheel3: 0)!; e.location = CGPoint(x: ${x}, y: ${y}); e.post(tap: .cghidEventTap); Thread.sleep(forTimeInterval: 0.03) }`;
    execSync(`swift -e '${swift}'`);
    await new Promise(r => setTimeout(r, 1500));
  }

  // === scrollChatListToTop ===
  async scrollChatListToTop(listBounds) {
    const x = listBounds.x + Math.floor(listBounds.width / 2);
    const y = listBounds.y + Math.floor(listBounds.height / 2);
    execSync(`${this.cliclickPath} c:${x},${y}`);
    await new Promise(r => setTimeout(r, 300));
    const swift = `import CoreGraphics; import Foundation; for _ in 0..<50 { let e = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: 3, wheel2: 0, wheel3: 0)!; e.location = CGPoint(x: ${x}, y: ${y}); e.post(tap: .cghidEventTap); Thread.sleep(forTimeInterval: 0.03) }`;
    execSync(`swift -e '${swift}'`);
    await new Promise(r => setTimeout(r, 1500));
  }

  async readSaveDialogFilename() {
    return await this.osa(`
      tell application "System Events"
        tell process "${this.appleEsc(this.lineProcessName)}"
          return value of text field "儲存為：" of splitter group 1 of sheet 1 of window 1
        end tell
      end tell
    `);
  }

  // === cancelSaveDialog ===
  async cancelSaveDialog() {
    try {
      await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            click button "取消" of splitter group 1 of sheet 1 of window 1
          end tell
        end tell
      `);
    } catch {
      await this.osa(`
        tell application "System Events"
          tell process "${this.appleEsc(this.lineProcessName)}"
            key code 53
          end tell
        end tell
      `);
    }
    await new Promise(r => setTimeout(r, 500));
  }

}
