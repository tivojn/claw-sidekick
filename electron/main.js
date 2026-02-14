const { app, BrowserWindow, ipcMain, Notification, shell, globalShortcut } = require('electron');
const path = require('path');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const WebSocket = require('ws');
require('dotenv').config();

// 捕获 EPIPE 错误，防止后台运行时崩溃
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // 忽略 EPIPE 错误
    return;
  }
  throw err;
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // 忽略 EPIPE 错误
    return;
  }
  throw err;
});

let mainWindow;

// ===== 任务管理器 =====
class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.taskQueue = [];
    this.isProcessing = false;
  }

  // 创建异步任务
  createTask(message) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const task = {
      id: taskId,
      message: message,
      status: 'pending',
      createdAt: Date.now(),
      result: null,
      error: null
    };

    this.tasks.set(taskId, task);
    this.taskQueue.push(taskId);

    console.log(`[TaskManager] 创建任务: ${taskId} - "${message}"`);

    // 开始处理队列
    this.processQueue();

    return taskId;
  }

  // 处理任务队列
  async processQueue() {
    if (this.isProcessing || this.taskQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const taskId = this.taskQueue.shift();

    await this.executeTask(taskId);

    this.isProcessing = false;

    // 继续处理下一个任务
    if (this.taskQueue.length > 0) {
      this.processQueue();
    }
  }

  // 执行任务
  async executeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    console.log(`[TaskManager] 开始执行任务: ${taskId}`);
    task.status = 'running';
    task.startedAt = Date.now();

    try {
      // 调用 Clawdbot
      const result = await chatWithClawdbot(task.message);

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      task.duration = task.completedAt - task.startedAt;

      console.log(`[TaskManager] 任务完成: ${taskId} (用时 ${task.duration}ms)`);

      // 通知前端
      this.notifyTaskCompleted(task);
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = Date.now();

      console.error(`[TaskManager] 任务失败: ${taskId} - ${error.message}`);

      // 通知前端失败
      this.notifyTaskFailed(task);
    }
  }

  // 通知前端任务完成
  notifyTaskCompleted(task) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-completed', {
        taskId: task.id,
        result: task.result,
        duration: task.duration
      });

      // 显示系统通知
      if (Notification.isSupported()) {
        new Notification({
          title: 'Task Complete',
          body: task.result.substring(0, 100) + (task.result.length > 100 ? '...' : ''),
          silent: false
        }).show();
      }
    }
  }

  // 通知前端任务失败
  notifyTaskFailed(task) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-failed', {
        taskId: task.id,
        error: task.error
      });
    }
  }

  // 获取任务状态
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  // 获取所有任务
  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  // 取消任务
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      task.status = 'cancelled';
      // 从队列中移除
      const index = this.taskQueue.indexOf(taskId);
      if (index > -1) {
        this.taskQueue.splice(index, 1);
      }
      console.log(`[TaskManager] 任务已取消: ${taskId}`);
      return true;
    }
    return false;
  }
}

const taskManager = new TaskManager();
let deepgramClient = null;
let deepgramLive = null;
let currentSender = null;

// ===== Clawdbot WebSocket 配置 =====
const CLAWDBOT_PORT = process.env.CLAWDBOT_PORT || 18789;
const CLAWDBOT_TOKEN = process.env.CLAWDBOT_TOKEN || '2ab8673b76059239a62412aac4d1dbc655d4d75205656db0';
const CLAWDBOT_WS_URL = `ws://localhost:${CLAWDBOT_PORT}`;

let clawdbotWs = null;
let clawdbotConnected = false;
let clawdbotRequestId = 0;
let clawdbotPendingRequests = new Map();

// ===== 句子分割器 =====
class SentenceSplitter {
  constructor(onSentence) {
    this.buffer = '';
    this.onSentence = onSentence;
    // 句子结束符：中文和英文
    this.sentenceEnders = /[。！？.!?]\s*/g;
  }

  // 添加文本流
  addText(text) {
    this.buffer += text;
    this.flush();
  }

  // 尝试提取完整句子
  flush() {
    let match;
    const regex = new RegExp(this.sentenceEnders.source, 'g');
    while ((match = regex.exec(this.buffer)) !== null) {
      const endIndex = match.index + match[0].length;
      const sentence = this.buffer.substring(0, endIndex).trim();
      this.buffer = this.buffer.substring(endIndex);

      if (sentence.length > 0) {
        this.onSentence(sentence);
      }
    }
  }

  // 强制刷新剩余缓冲区（流结束时调用）
  finish() {
    if (this.buffer.trim().length > 0) {
      this.onSentence(this.buffer.trim());
      this.buffer = '';
    }
  }

  // 重置
  reset() {
    this.buffer = '';
  }
}

// ===== TTS 音频队列管理器 =====
class TTSQueueManager {
  constructor() {
    this.audioQueue = [];
    this.isProcessing = false;
    this.currentSentenceId = 0;
    this.isStopped = false;
  }

  // 重置队列
  reset() {
    this.audioQueue = [];
    this.isProcessing = false;
    this.currentSentenceId = 0;
    this.isStopped = true;
  }

  // 开始新的会话
  startSession() {
    this.audioQueue = [];
    this.isProcessing = false;
    this.currentSentenceId = 0;
    this.isStopped = false;
  }

  // 添加句子到队列
  async enqueueSentence(sentence) {
    if (this.isStopped) return;

    const sentenceId = ++this.currentSentenceId;
    console.log(`[TTS Queue] 排队句子 #${sentenceId}: "${sentence.substring(0, 30)}..."`);

    this.audioQueue.push({ sentence, sentenceId });

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  // 处理队列
  async processQueue() {
    if (this.isProcessing || this.audioQueue.length === 0) return;

    this.isProcessing = true;

    while (this.audioQueue.length > 0 && !this.isStopped) {
      const item = this.audioQueue.shift();

      try {
        // 调用 TTS 生成音频
        const audioData = await callTTS(item.sentence);

        if (audioData && mainWindow && !mainWindow.isDestroyed()) {
          // 发送音频块到前端
          mainWindow.webContents.send('tts:audioChunk', {
            sentenceId: item.sentenceId,
            audio: audioData,
            text: item.sentence,
            isLast: this.audioQueue.length === 0
          });
        }
      } catch (error) {
        console.error(`[TTS Queue] 句子 #${item.sentenceId} 生成失败:`, error);
      }
    }

    this.isProcessing = false;
  }
}

const ttsQueueManager = new TTSQueueManager();
let sentenceCounter = 0;

// ===== Clawdbot WebSocket 连接 =====
function connectClawdbot() {
  if (clawdbotWs && clawdbotWs.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    console.log(`[Clawdbot] 正在连接 ${CLAWDBOT_WS_URL}...`);
    clawdbotWs = new WebSocket(CLAWDBOT_WS_URL);

    const timeout = setTimeout(() => {
      reject(new Error('Clawdbot 连接超时'));
    }, 10000);

    clawdbotWs.on('open', () => {
      console.log('[Clawdbot] WebSocket 已连接，等待握手...');
    });

    clawdbotWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // 处理连接挑战
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          console.log('[Clawdbot] 收到连接挑战，发送认证...');
          clawdbotWs.send(JSON.stringify({
            type: 'req',
            id: 'connect-1',
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'gateway-client',
                version: '1.0.0',
                platform: 'electron',
                mode: 'backend'
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              auth: { token: CLAWDBOT_TOKEN }
            }
          }));
        }

        // 处理响应
        if (msg.type === 'res') {
          if (msg.id === 'connect-1') {
            if (msg.ok) {
              clearTimeout(timeout);
              clawdbotConnected = true;
              console.log('[Clawdbot] 认证成功 ✓');
              resolve();
            } else {
              clearTimeout(timeout);
              reject(new Error(msg.error?.message || '认证失败'));
            }
          } else {
            // 处理其他请求的响应
            const pending = clawdbotPendingRequests.get(msg.id);
            if (pending) {
              clawdbotPendingRequests.delete(msg.id);
              if (msg.ok) {
                pending.resolve(msg.payload);
              } else {
                pending.reject(new Error(msg.error?.message || '请求失败'));
              }
            }
          }
        }

        // 处理聊天事件（流式响应）
        if (msg.type === 'event' && msg.event === 'chat') {
          const pending = clawdbotPendingRequests.get('chat-stream');
          if (pending && msg.payload) {
            if (msg.payload.done) {
              clawdbotPendingRequests.delete('chat-stream');
              pending.resolve(pending.fullText || '');
            } else if (msg.payload.text) {
              pending.fullText = (pending.fullText || '') + msg.payload.text;
            }
          }
        }
      } catch (e) {
        console.error('[Clawdbot] 消息解析错误:', e);
      }
    });

    clawdbotWs.on('error', (err) => {
      console.error('[Clawdbot] WebSocket 错误:', err.message);
      clawdbotConnected = false;
    });

    clawdbotWs.on('close', () => {
      console.log('[Clawdbot] WebSocket 已断开');
      clawdbotConnected = false;
      clawdbotWs = null;
    });
  });
}

// 发送 Clawdbot 请求
function clawdbotRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!clawdbotWs || clawdbotWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Clawdbot 未连接'));
      return;
    }

    const id = `req-${++clawdbotRequestId}`;
    clawdbotPendingRequests.set(id, { resolve, reject });

    clawdbotWs.send(JSON.stringify({
      type: 'req',
      id,
      method,
      params
    }));

    // 超时处理
    setTimeout(() => {
      if (clawdbotPendingRequests.has(id)) {
        clawdbotPendingRequests.delete(id);
        reject(new Error('请求超时'));
      }
    }, 30000);
  });
}

// 发送聊天消息到 Clawdbot（支持流式句子分发）
async function chatWithClawdbot(message) {
  try {
    await connectClawdbot();

    console.log(`[Clawdbot] 发送消息: "${message}"`);

    // 生成唯一的 idempotencyKey
    const idempotencyKey = `openclaw-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 发送消息并等待完成
    const chatReqId = `chat-${++clawdbotRequestId}`;
    let accumulatedText = '';

    // 重置句子计数器和 TTS 队列
    sentenceCounter = 0;
    ttsQueueManager.startSession();

    // 创建句子分割器
    const splitter = new SentenceSplitter((sentence) => {
      const currentSentenceId = ++sentenceCounter;
      console.log(`[Clawdbot] 句子 #${currentSentenceId}: "${sentence}"`);

      // 第一个句子立即发送到前端显示
      if (currentSentenceId === 1 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clawdbot:firstSentence', { text: sentence });
      }

      // 将句子加入 TTS 队列
      ttsQueueManager.enqueueSentence(sentence);
    });

    return new Promise((resolve, reject) => {
      // 复杂任务（搜索、工具调用等）可能需要较长时间，超时设为 180 秒
      const timeout = setTimeout(() => {
        if (clawdbotWs) {
          clawdbotWs.removeListener('message', chatHandler);
        }
        // 超时但有累积文本时，返回已收到的部分
        if (accumulatedText.length > 0) {
          console.log('[Clawdbot] 响应超时，返回已累积文本:', accumulatedText.substring(0, 200));
          splitter.finish(); // 刷新剩余文本
          resolve(accumulatedText);
        } else {
          reject(new Error('Clawdbot 响应超时'));
        }
      }, 180000);

      // 监听消息
      const chatHandler = (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // 详细日志：记录所有 Clawdbot 消息（调试）
          if (msg.type === 'event') {
            console.log(`[Clawdbot] 事件: ${msg.event}, payload keys: ${Object.keys(msg.payload || {}).join(',')}, state: ${msg.payload?.state || '-'}`);
          } else if (msg.type === 'res' && msg.id !== 'connect-1') {
            console.log(`[Clawdbot] 响应: id=${msg.id}, ok=${msg.ok}`);
          }

          // 1. 处理 chat.send 请求的直接响应（错误检测）
          if (msg.type === 'res' && msg.id === chatReqId) {
            if (!msg.ok) {
              console.error('[Clawdbot] chat.send 请求被拒绝:', msg.error?.message || JSON.stringify(msg.error));
              clawdbotWs.removeListener('message', chatHandler);
              clearTimeout(timeout);
              reject(new Error(msg.error?.message || 'chat.send 请求失败'));
              return;
            }
            console.log('[Clawdbot] chat.send 请求已接受');
          }

          // 2. 监听 chat 流式事件（累积文本 + 分句处理）
          if (msg.type === 'event' && msg.event === 'chat') {
            const payload = msg.payload || {};

            // 累积流式文本
            if (payload.text) {
              accumulatedText += payload.text;
              // 将新文本喂给分割器
              splitter.addText(payload.text);
            }

            // 检查完成状态
            if (payload.state === 'final' || payload.done === true) {
              console.log('[Clawdbot] 收到 chat final 事件');
              clawdbotWs.removeListener('message', chatHandler);

              // 刷新分割器剩余文本
              splitter.finish();

              // 如果流式已累积文本，直接使用
              if (accumulatedText.length > 0) {
                clearTimeout(timeout);
                console.log('[Clawdbot] AI 回复 (流式):', accumulatedText.substring(0, 200));
                resolve(accumulatedText);
                return;
              }

              // 否则从历史记录获取
              clawdbotRequest('chat.history', {
                sessionKey: 'agent:main:main',
                limit: 2
              }).then(history => {
                clearTimeout(timeout);
                if (history?.messages) {
                  const lastAssistant = history.messages.find(m => m.role === 'assistant');
                  if (lastAssistant && lastAssistant.content) {
                    const textContent = lastAssistant.content.find(c => c.type === 'text');
                    if (textContent) {
                      console.log('[Clawdbot] AI 回复 (历史):', textContent.text.substring(0, 200));
                      resolve(textContent.text);
                      return;
                    }
                  }
                }
                resolve('Received, but no reply content found.');
              }).catch(err => {
                clearTimeout(timeout);
                reject(err);
              });
            }
          }

          // 3. 监听所有其他事件（Clawdbot 可能通过不同事件名返回结果）
          if (msg.type === 'event' && msg.event !== 'chat' && msg.event !== 'connect.challenge') {
            const payload = msg.payload || {};
            // 尝试从任意事件中提取文本
            if (payload.text && typeof payload.text === 'string') {
              console.log(`[Clawdbot] 从事件 "${msg.event}" 收到文本: ${payload.text.substring(0, 100)}`);
              accumulatedText += payload.text;
              splitter.addText(payload.text);
            }
            if (payload.message && typeof payload.message === 'string') {
              console.log(`[Clawdbot] 从事件 "${msg.event}" 收到 message: ${payload.message.substring(0, 100)}`);
              if (!accumulatedText) accumulatedText = payload.message;
            }
            if (payload.result && typeof payload.result === 'string') {
              console.log(`[Clawdbot] 从事件 "${msg.event}" 收到 result: ${payload.result.substring(0, 100)}`);
              if (!accumulatedText) accumulatedText = payload.result;
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      };

      clawdbotWs.on('message', chatHandler);

      // 发送消息
      clawdbotWs.send(JSON.stringify({
        type: 'req',
        id: chatReqId,
        method: 'chat.send',
        params: {
          sessionKey: 'agent:main:main',
          idempotencyKey: idempotencyKey,
          message: message
        }
      }));
    });
  } catch (error) {
    console.error('[Clawdbot] 聊天失败:', error.message);
    throw error;
  }
}

// ===== 窗口创建 =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 330,
    height: 550,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  // Position window at upper-right of screen
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const x = display.workArea.x + display.workArea.width - FULL_WIDTH - 30;
  const y = display.workArea.y + 30;
  mainWindow.setPosition(x, y);

  // Log renderer console messages to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    console.log(`[Renderer/${prefix}] ${message}`);
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== 命令处理（通过 Clawdbot） =====
ipcMain.handle('openclaw:executeCommand', async (event, command) => {
  console.log('[CMD] 收到命令:', command);

  try {
    const reply = await chatWithClawdbot(command);
    console.log(`[CMD] Clawdbot 回复: ${reply}`);
    return { type: 'chat', data: null, message: reply };
  } catch (error) {
    console.error('[CMD] Clawdbot 调用失败:', error.message);
    // 降级处理：返回友好提示
    return {
      type: 'chat',
      data: null,
      message: 'Clawdbot is temporarily unavailable. Make sure the service is running.'
    };
  }
});

// ===== 异步任务管理 =====
ipcMain.handle('task:create', async (event, message) => {
  const taskId = taskManager.createTask(message);
  return { success: true, taskId };
});

ipcMain.handle('task:get', async (event, taskId) => {
  const task = taskManager.getTask(taskId);
  return task || null;
});

ipcMain.handle('task:getAll', async (event) => {
  return taskManager.getAllTasks();
});

ipcMain.handle('task:cancel', async (event, taskId) => {
  const success = taskManager.cancelTask(taskId);
  return { success };
});

// ===== Deepgram STT =====
let deepgramKeepAlive = null;
let isListeningActive = false; // 是否处于活动听写状态（用于长连接优化）

ipcMain.handle('deepgram:startListening', async (event) => {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey || apiKey === 'your_deepgram_api_key_here') {
      return { success: false, error: 'Please configure DEEPGRAM_API_KEY in .env file' };
    }

    currentSender = event.sender;

    // 复用已有连接（如果仍然活跃）
    if (deepgramLive) {
      try {
        const readyState = deepgramLive.getReadyState();
        if (readyState === 1) { // WebSocket.OPEN
          console.log('[STT] 复用现有 Deepgram 连接 ✓');
          isListeningActive = true; // 激活听写状态
          return { success: true };
        }
      } catch (e) { /* 连接异常，重新创建 */ }
      // 连接已关闭或异常，清理后重建
      if (deepgramKeepAlive) { clearInterval(deepgramKeepAlive); deepgramKeepAlive = null; }
      try { deepgramLive.finish(); } catch (e) {}
      deepgramLive = null;
    }

    console.log(`[STT] Deepgram API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);

    // 创建新连接
    deepgramClient = createClient(apiKey);

    console.log('[STT] 正在建立 Deepgram WebSocket 连接...');

    deepgramLive = deepgramClient.listen.live({
      model: 'nova-2',
      language: 'zh-CN',
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1200,
      vad_events: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      endpointing: 300
    });

    // 连接超时检测（10秒内没建立则报错）
    const connectTimeout = setTimeout(() => {
      if (deepgramLive) {
        const rs = deepgramLive.getReadyState();
        if (rs !== 1) {
          console.error(`[STT] Deepgram 连接超时 (readyState=${rs})，可能 API Key 无效`);
          if (currentSender && !currentSender.isDestroyed()) {
            currentSender.send('deepgram:error', 'Deepgram 连接超时，请检查 API Key 是否有效');
          }
          try { deepgramLive.finish(); } catch (e) {}
          deepgramLive = null;
        }
      }
    }, 10000);

    deepgramLive.on(LiveTranscriptionEvents.Open, () => {
      clearTimeout(connectTimeout);
      console.log('[STT] Deepgram 连接已建立 ✓');
      // KeepAlive: 每 8 秒发送心跳，防止空闲断开
      deepgramKeepAlive = setInterval(() => {
        if (deepgramLive) {
          try { deepgramLive.keepAlive(); } catch (e) {}
        }
      }, 8000);
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:connected');
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.Transcript, (data) => {
      // 关键：只有在活动状态下才处理转写结果（长连接优化）
      if (!isListeningActive) {
        return;
      }

      if (!data.channel || !data.channel.alternatives || data.channel.alternatives.length === 0) return;

      const transcript = data.channel.alternatives[0].transcript;
      const isFinal = data.is_final;

      if (transcript && transcript.trim().length > 0) {
        console.log(`[STT] ${isFinal ? '✓ 最终' : '... 临时'}: "${transcript}"`);
        if (currentSender && !currentSender.isDestroyed()) {
          currentSender.send('deepgram:transcript', { transcript, isFinal });
        }
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      // 只有活动状态下才通知前端（长连接优化）
      if (!isListeningActive) return;

      console.log('[STT] UtteranceEnd - 用户停止说话');
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:utteranceEnd');
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.Error, (error) => {
      clearTimeout(connectTimeout);
      console.error('[STT] Deepgram 错误:', error);
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:error', error.message || String(error));
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.Close, () => {
      clearTimeout(connectTimeout);
      if (deepgramKeepAlive) { clearInterval(deepgramKeepAlive); deepgramKeepAlive = null; }
      console.log('[STT] Deepgram 连接已关闭');
      isListeningActive = false; // 重置状态
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:closed');
      }
    });

    isListeningActive = true; // 激活听写状态
    return { success: true };
  } catch (error) {
    console.error('[STT] 启动失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('deepgram:stopListening', async () => {
  // 长连接优化：不再断开连接，只是暂停听写状态
  isListeningActive = false;
  console.log('[STT] 停止听写（暂停状态，连接保持）');
  return { success: true };
});

ipcMain.handle('deepgram:sendAudio', async (event, audioData) => {
  try {
    // 只有在活动状态下才发送音频数据
    if (deepgramLive && audioData && isListeningActive) {
      const readyState = deepgramLive.getReadyState();
      if (readyState === 1) {
        const buffer = Buffer.from(audioData);
        deepgramLive.send(buffer);
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Edge-TTS =====
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');

// 当前选择的音色（可被前端动态修改）
let currentVoiceId = 'en-US-EmmaMultilingualNeural';

// ===== TTS Provider 配置 =====
let currentTTSProvider = 'edge';  // 'edge' | 'minimax'
let minimaxConfig = { apiKey: '', voiceId: 'English_Graceful_Lady' };
let currentAvatarId = 'amy'; // default avatar

// ===== Settings persistence =====
const SETTINGS_PATH = path.join(os.homedir(), '.claw-sidekick-settings.json');
const OLD_TTS_CONFIG_PATH = path.join(os.homedir(), '.claw-sidekick-tts.json');

const DEFAULT_SETTINGS = {
  providers: {
    minimax: { apiKey: '' },
    groq: { apiKey: '' }
  },
  avatars: {
    lobster: { ttsProvider: 'edge', edgeVoice: 'en-US-EmmaMultilingualNeural', minimaxVoice: 'English_Graceful_Lady' },
    amy: { ttsProvider: 'edge', edgeVoice: 'zh-CN-XiaoyiNeural', minimaxVoice: 'Chinese (Mandarin)_Lyrical_Voice' },
    cat: { ttsProvider: 'edge', edgeVoice: 'en-US-BrianMultilingualNeural', minimaxVoice: 'English_Persuasive_Man' },
    robot: { ttsProvider: 'edge', edgeVoice: 'en-US-BrianMultilingualNeural', minimaxVoice: 'English_Lucky_Robot' }
  },
  stt: { provider: 'deepgram', groqModel: 'whisper-large-v3-turbo' },
  hotkey: null,
  connection: { provider: 'openclaw', claudeCodePath: '' }
};

let appSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

// Load settings (with migration from old format)
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      // Deep merge with defaults (so new fields are added on upgrade)
      appSettings = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), saved);
      console.log('[Settings] Loaded from', SETTINGS_PATH);
    } else if (fs.existsSync(OLD_TTS_CONFIG_PATH)) {
      // Migrate from old format
      const old = JSON.parse(fs.readFileSync(OLD_TTS_CONFIG_PATH, 'utf-8'));
      if (old.minimax && old.minimax.apiKey) {
        appSettings.providers.minimax.apiKey = old.minimax.apiKey;
      }
      if (old.minimax && old.minimax.voiceId) {
        // Apply old minimax voice to all avatars as their minimaxVoice
        for (const avatarId of Object.keys(appSettings.avatars)) {
          appSettings.avatars[avatarId].minimaxVoice = old.minimax.voiceId;
        }
      }
      if (old.provider) {
        // Apply old provider to all avatars
        for (const avatarId of Object.keys(appSettings.avatars)) {
          appSettings.avatars[avatarId].ttsProvider = old.provider;
        }
      }
      saveSettings();
      console.log('[Settings] Migrated from old format');
    }
  } catch (e) {
    console.warn('[Settings] Load failed:', e.message);
  }

  // Sync runtime state from settings
  syncRuntimeFromSettings();
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function syncRuntimeFromSettings() {
  // Sync minimax API key into runtime config
  minimaxConfig.apiKey = appSettings.providers.minimax.apiKey || '';

  // Load current avatar's config into active state
  const avatarCfg = appSettings.avatars[currentAvatarId] || appSettings.avatars.amy;
  currentTTSProvider = avatarCfg.ttsProvider || 'edge';
  currentVoiceId = avatarCfg.edgeVoice || 'en-US-EmmaMultilingualNeural';
  minimaxConfig.voiceId = avatarCfg.minimaxVoice || 'English_Graceful_Lady';
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(appSettings, null, 2));
    console.log('[Settings] Saved');
  } catch (e) {
    console.error('[Settings] Save failed:', e.message);
  }
}

// Load on startup
loadSettings();

// 核心 TTS 函数（使用 edge-tts CLI）
async function callEdgeTTS(text) {
  const tmpFile = path.join(os.tmpdir(), `edge-tts-${Date.now()}.mp3`);
  console.log(`[TTS] edge-tts 生成语音 (音色: ${currentVoiceId}): "${text.substring(0, 50)}..."`);

  return new Promise((resolve, reject) => {
    const args = ['--voice', currentVoiceId, '--text', text, '--write-media', tmpFile];
    execFile('edge-tts', args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        return reject(new Error(`edge-tts 失败: ${error.message}`));
      }

      try {
        const audioBuffer = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);

        console.log(`[TTS] edge-tts 生成音频: ${audioBuffer.length} 字节`);
        if (audioBuffer.length < 100) {
          return reject(new Error('TTS 音频数据太小'));
        }

        resolve(audioBuffer.toString('base64'));
      } catch (readErr) {
        reject(new Error(`读取音频文件失败: ${readErr.message}`));
      }
    });
  });
}

// ===== MiniMax TTS =====
const https = require('https');

async function callMiniMaxTTS(text) {
  if (!minimaxConfig.apiKey) {
    throw new Error('MiniMax API key not configured');
  }

  console.log(`[TTS] MiniMax 生成语音: "${text.substring(0, 50)}..."`);

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'speech-2.8-hd',
      text: text,
      stream: false,
      voice_setting: {
        voice_id: minimaxConfig.voiceId || 'English_Graceful_Lady',
        speed: 1.0,
        vol: 1.0,
        pitch: 0
      },
      audio_setting: {
        format: 'mp3',
        sample_rate: 32000,
        bitrate: 128000,
        channel: 1
      },
      output_format: 'hex'
    });

    const options = {
      hostname: 'api.minimax.io',
      path: '/v1/t2a_v2',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${minimaxConfig.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          if (json.base_resp && json.base_resp.status_code !== 0) {
            return reject(new Error(`MiniMax API error: ${json.base_resp.status_msg || 'Unknown error'}`));
          }

          // International API: audio is at data.audio (hex string directly)
          const hexAudio = json.data && json.data.audio;
          if (!hexAudio) {
            return reject(new Error('MiniMax: no audio data in response'));
          }

          // Hex string → Buffer → base64
          const audioBuffer = Buffer.from(hexAudio, 'hex');
          console.log(`[TTS] MiniMax 生成音频: ${audioBuffer.length} 字节`);

          if (audioBuffer.length < 100) {
            return reject(new Error('MiniMax: audio data too small'));
          }

          resolve(audioBuffer.toString('base64'));
        } catch (e) {
          reject(new Error(`MiniMax: failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`MiniMax request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('MiniMax request timed out')); });
    req.write(body);
    req.end();
  });
}

// ===== TTS Router =====
async function callTTS(text) {
  if (currentTTSProvider === 'minimax' && minimaxConfig.apiKey) {
    return callMiniMaxTTS(text);
  }
  return callEdgeTTS(text);
}

// 前端设置音色
ipcMain.handle('tts:setVoice', async (event, voiceId) => {
  console.log(`[TTS] 音色已切换: ${currentVoiceId} → ${voiceId}`);
  currentVoiceId = voiceId;
  return { success: true };
});

// 前端获取当前音色
ipcMain.handle('tts:getVoice', async () => {
  return { voiceId: currentVoiceId };
});

// 停止 TTS 播放
ipcMain.handle('tts:stop', async () => {
  console.log('[TTS] 停止播放');
  ttsQueueManager.reset();
  return { success: true };
});

// 非流式 TTS（兼容旧接口）
ipcMain.handle('deepgram:textToSpeech', async (event, text) => {
  try {
    const audioBase64 = await callTTS(text);
    return { success: true, audio: audioBase64 };
  } catch (error) {
    console.error('[TTS] Edge-TTS failed:', error);
    return { success: false, error: error.message };
  }
});

// ===== TTS Provider 设置 =====
ipcMain.handle('tts:setProvider', async (event, provider) => {
  console.log(`[TTS] Provider 切换: ${currentTTSProvider} → ${provider}`);
  currentTTSProvider = provider;
  // 持久化
  saveTTSConfig();
  return { success: true };
});

ipcMain.handle('tts:getProvider', async () => {
  return { provider: currentTTSProvider };
});

ipcMain.handle('tts:setProviderConfig', async (event, provider, config) => {
  if (provider === 'minimax') {
    if (config.apiKey) minimaxConfig.apiKey = config.apiKey;
    console.log(`[TTS] MiniMax 配置已更新`);
    saveTTSConfig();
  }
  return { success: true };
});

ipcMain.handle('tts:getProviderConfig', async (event, provider) => {
  if (provider === 'minimax') {
    return {
      apiKeyMasked: minimaxConfig.apiKey
        ? minimaxConfig.apiKey.substring(0, 7) + '****' + minimaxConfig.apiKey.substring(minimaxConfig.apiKey.length - 4)
        : '',
      hasKey: !!minimaxConfig.apiKey
    };
  }
  return {};
});

// Validate MiniMax API key by fetching system voices
ipcMain.handle('tts:validateMinimax', async (event, apiKey) => {
  // Support re-validation with stored key
  const keyToUse = (apiKey === '__use_stored__') ? minimaxConfig.apiKey : apiKey;
  if (!keyToUse) {
    return { success: false, error: 'No API key provided' };
  }
  console.log('[TTS] Validating MiniMax API key...');
  return new Promise((resolve) => {
    const body = JSON.stringify({ voice_type: 'system' });

    const req = https.request({
      hostname: 'api.minimax.io',
      path: '/v1/get_voice',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyToUse}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.base_resp && json.base_resp.status_code !== 0) {
            console.error('[TTS] MiniMax validation failed:', json.base_resp.status_msg);
            return resolve({ success: false, error: json.base_resp.status_msg || 'Invalid API key' });
          }
          // Extract system voices
          const voices = (json.system_voice || []).map(v => ({
            id: v.voice_id,
            name: v.voice_name || v.voice_id,
            desc: v.description || ''
          }));
          console.log(`[TTS] MiniMax validation OK, ${voices.length} voices available`);
          // Save the key
          minimaxConfig.apiKey = keyToUse;
          saveTTSConfig();
          resolve({ success: true, voices });
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse response' });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Request timed out' }); });
    req.write(body);
    req.end();
  });
});

// Set MiniMax voice
ipcMain.handle('tts:setMinimaxVoice', async (event, voiceId) => {
  console.log(`[TTS] MiniMax voice: ${minimaxConfig.voiceId} → ${voiceId}`);
  minimaxConfig.voiceId = voiceId;
  saveTTSConfig();
  return { success: true };
});

ipcMain.handle('tts:getMinimaxVoice', async () => {
  return { voiceId: minimaxConfig.voiceId || 'English_Graceful_Lady' };
});

// ===== Per-avatar TTS routing =====
ipcMain.handle('tts:switchAvatar', async (event, avatarId) => {
  if (!appSettings.avatars[avatarId]) {
    console.warn(`[TTS] Unknown avatar: ${avatarId}, using defaults`);
    return { success: false, error: 'Unknown avatar' };
  }
  console.log(`[TTS] Switch avatar: ${currentAvatarId} → ${avatarId}`);
  currentAvatarId = avatarId;
  syncRuntimeFromSettings();
  console.log(`[TTS] Active: provider=${currentTTSProvider}, edgeVoice=${currentVoiceId}, minimaxVoice=${minimaxConfig.voiceId}`);
  return { success: true, provider: currentTTSProvider, edgeVoice: currentVoiceId, minimaxVoice: minimaxConfig.voiceId };
});

ipcMain.handle('tts:setAvatarConfig', async (event, avatarId, config) => {
  if (!appSettings.avatars[avatarId]) {
    // Allow creating config for unknown avatars
    appSettings.avatars[avatarId] = { ...DEFAULT_SETTINGS.avatars.amy };
  }
  const avatar = appSettings.avatars[avatarId];
  if (config.ttsProvider !== undefined) avatar.ttsProvider = config.ttsProvider;
  if (config.edgeVoice !== undefined) avatar.edgeVoice = config.edgeVoice;
  if (config.minimaxVoice !== undefined) avatar.minimaxVoice = config.minimaxVoice;
  saveSettings();

  // If this is the active avatar, update runtime state
  if (avatarId === currentAvatarId) {
    syncRuntimeFromSettings();
  }
  console.log(`[TTS] Avatar config updated: ${avatarId}`, avatar);
  return { success: true };
});

ipcMain.handle('tts:getAvatarConfig', async (event, avatarId) => {
  const avatar = appSettings.avatars[avatarId] || null;
  return avatar;
});

// ===== MiniMax voice preview =====
ipcMain.handle('tts:previewMinimax', async (event, voiceId) => {
  const apiKey = appSettings.providers.minimax.apiKey;
  if (!apiKey) {
    return { success: false, error: 'MiniMax API key not configured' };
  }
  console.log(`[TTS] Preview MiniMax voice: ${voiceId}`);
  try {
    const previewText = 'Hello, this is a preview of my voice.';
    const audio = await callMiniMaxTTSWithVoice(previewText, voiceId, apiKey);
    return { success: true, audio };
  } catch (error) {
    console.error('[TTS] MiniMax preview failed:', error.message);
    return { success: false, error: error.message };
  }
});

// MiniMax TTS with explicit voice override (used by preview)
async function callMiniMaxTTSWithVoice(text, voiceId, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'speech-2.8-hd',
      text: text,
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: 1.0,
        vol: 1.0,
        pitch: 0
      },
      audio_setting: {
        format: 'mp3',
        sample_rate: 32000,
        bitrate: 128000,
        channel: 1
      },
      output_format: 'hex'
    });

    const options = {
      hostname: 'api.minimax.io',
      path: '/v1/t2a_v2',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.base_resp && json.base_resp.status_code !== 0) {
            return reject(new Error(`MiniMax API error: ${json.base_resp.status_msg || 'Unknown error'}`));
          }
          const hexAudio = json.data && json.data.audio;
          if (!hexAudio) {
            return reject(new Error('MiniMax: no audio data in response'));
          }
          const audioBuffer = Buffer.from(hexAudio, 'hex');
          if (audioBuffer.length < 100) {
            return reject(new Error('MiniMax: audio data too small'));
          }
          resolve(audioBuffer.toString('base64'));
        } catch (e) {
          reject(new Error(`MiniMax: failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`MiniMax request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('MiniMax request timed out')); });
    req.write(body);
    req.end();
  });
}

// ===== Groq Whisper STT =====
ipcMain.handle('stt:setProvider', async (event, provider) => {
  console.log(`[STT] Provider: ${appSettings.stt.provider} → ${provider}`);
  appSettings.stt.provider = provider;
  saveSettings();
  return { success: true };
});

ipcMain.handle('stt:getProvider', async () => {
  return { provider: appSettings.stt.provider, groqModel: appSettings.stt.groqModel };
});

ipcMain.handle('stt:validateGroq', async (event, apiKey) => {
  console.log('[STT] Validating Groq API key...');
  try {
    // Generate a minimal WAV file (0.5s of silence, 16kHz mono 16-bit PCM)
    const sampleRate = 16000;
    const duration = 0.5;
    const numSamples = Math.floor(sampleRate * duration);
    const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
    const wavHeaderSize = 44;
    const wavBuffer = Buffer.alloc(wavHeaderSize + dataSize);

    // WAV header
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(wavHeaderSize + dataSize - 8, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16); // fmt chunk size
    wavBuffer.writeUInt16LE(1, 20);  // PCM format
    wavBuffer.writeUInt16LE(1, 22);  // mono
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    wavBuffer.writeUInt16LE(2, 32);  // block align
    wavBuffer.writeUInt16LE(16, 34); // bits per sample
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataSize, 40);
    // Data is already zeros (silence)

    const result = await groqTranscribe(wavBuffer, apiKey, appSettings.stt.groqModel);
    // Key is valid, save it
    appSettings.providers.groq.apiKey = apiKey;
    saveSettings();
    console.log('[STT] Groq API key validated OK');
    return { success: true };
  } catch (error) {
    console.error('[STT] Groq validation failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stt:setGroqModel', async (event, model) => {
  console.log(`[STT] Groq model: ${appSettings.stt.groqModel} → ${model}`);
  appSettings.stt.groqModel = model;
  saveSettings();
  return { success: true };
});

ipcMain.handle('stt:transcribeGroq', async (event, audioBase64) => {
  const apiKey = appSettings.providers.groq.apiKey;
  if (!apiKey) {
    return { success: false, error: 'Groq API key not configured' };
  }
  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const result = await groqTranscribe(audioBuffer, apiKey, appSettings.stt.groqModel);
    return { success: true, text: result };
  } catch (error) {
    console.error('[STT] Groq transcription failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Groq transcription helper (manual multipart form data, no external deps)
function groqTranscribe(audioBuffer, apiKey, model) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now().toString(36) + Math.random().toString(36).substr(2);
    const fileName = 'audio.wav';

    // Build multipart body
    const parts = [];

    // File field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // Model field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${model || 'whisper-large-v3-turbo'}\r\n`
    ));

    // Closing boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            return reject(new Error(json.error?.message || `Groq API error (${res.statusCode})`));
          }
          resolve(json.text || '');
        } catch (e) {
          reject(new Error(`Groq: failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Groq request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq request timed out')); });
    req.write(body);
    req.end();
  });
}

function saveTTSConfig() {
  // Sync runtime state back into settings
  appSettings.providers.minimax.apiKey = minimaxConfig.apiKey || '';
  if (currentAvatarId && appSettings.avatars[currentAvatarId]) {
    appSettings.avatars[currentAvatarId].ttsProvider = currentTTSProvider;
    appSettings.avatars[currentAvatarId].edgeVoice = currentVoiceId;
    appSettings.avatars[currentAvatarId].minimaxVoice = minimaxConfig.voiceId;
  }
  saveSettings();
}

// ===== 窗口控制 =====
const FULL_WIDTH = 330;
const FULL_HEIGHT = 550;
const MINI_SIZE = 80;
let isMiniMode = false;

ipcMain.on('window:minimize', () => {
  if (!mainWindow) return;
  isMiniMode = true;
  const bounds = mainWindow.getBounds();
  mainWindow._restoreX = bounds.x;
  mainWindow._restoreY = bounds.y;
  mainWindow.setMinimumSize(MINI_SIZE, MINI_SIZE);
  mainWindow.setSize(MINI_SIZE, MINI_SIZE);
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const x = display.workArea.x + display.workArea.width - MINI_SIZE - 20;
  const y = display.workArea.y + Math.floor(display.workArea.height * 0.55);
  mainWindow.setPosition(x, y);
  mainWindow.webContents.send('window:miniMode', true);
});

ipcMain.on('window:restore', () => {
  if (!mainWindow) return;
  isMiniMode = false;
  mainWindow.setMinimumSize(200, 300);
  mainWindow.setSize(FULL_WIDTH, FULL_HEIGHT);
  if (mainWindow._restoreX !== undefined) {
    mainWindow.setPosition(mainWindow._restoreX, mainWindow._restoreY);
  } else {
    mainWindow.center();
  }
  mainWindow.webContents.send('window:miniMode', false);
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window:setPosition', (event, x, y) => {
  if (mainWindow) mainWindow.setPosition(Math.round(x), Math.round(y));
});

// ===== 文件操作 =====
// 在 Finder 中显示文件
ipcMain.handle('file:showInFolder', async (event, filePath) => {
  try {
    const fs = require('fs');
    const os = require('os');

    // 展开 ~ 为用户目录
    let expandedPath = filePath;
    if (filePath.startsWith('~/')) {
      expandedPath = filePath.replace('~', os.homedir());
    }

    // 验证路径是否存在
    if (!fs.existsSync(expandedPath)) {
      console.warn('[File] 文件不存在:', expandedPath);
      return { success: false, error: 'File not found' };
    }

    // 在 Finder 中显示文件
    shell.showItemInFolder(expandedPath);
    console.log('[File] 在 Finder 中显示:', expandedPath);
    return { success: true };
  } catch (error) {
    console.error('[File] 打开失败:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== PTT globalShortcut =====
let registeredPTTShortcut = null;

function comboToAccelerator(combo) {
  if (!combo || combo.code === 'fn') return null; // fn not detectable
  const parts = [];
  if (combo.alt) parts.push('Alt');
  if (combo.ctrl) parts.push('CommandOrControl');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Super');

  // Map code to Electron accelerator key name
  const code = combo.code || '';
  if (code === 'Space') parts.push('Space');
  else if (code.startsWith('Key')) parts.push(code.slice(3));
  else if (code.startsWith('Digit')) parts.push(code.slice(5));
  else if (/^F\d+$/.test(code)) parts.push(code);
  else return null;

  return parts.join('+');
}

function registerPTTShortcut(combo) {
  // Unregister previous
  if (registeredPTTShortcut) {
    try { globalShortcut.unregister(registeredPTTShortcut); } catch (e) {}
    registeredPTTShortcut = null;
  }
  const accel = comboToAccelerator(combo);
  if (!accel) return;
  try {
    globalShortcut.register(accel, () => {
      // Send PTT toggle event to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ptt:toggle');
      }
    });
    registeredPTTShortcut = accel;
    console.log('[PTT] Registered global shortcut:', accel);
  } catch (e) {
    console.warn('[PTT] Failed to register shortcut:', accel, e.message);
  }
}

// IPC to update PTT shortcut from renderer
ipcMain.handle('ptt:setShortcut', (event, combo) => {
  registerPTTShortcut(combo);
  return { success: true };
});

// ===== 应用生命周期 =====
app.whenReady().then(() => {
  createWindow();
  // 预连接 Clawdbot（不等待，后台连接）
  connectClawdbot().then(() => {
    console.log('[启动] Clawdbot 预连接成功');
  }).catch(err => {
    console.warn('[启动] Clawdbot 预连接失败（首次对话时会重试）:', err.message);
  });
  // Register default PTT shortcut (Option+Space)
  const savedCombo = appSettings.hotkey || { alt: true, code: 'Space' };
  registerPTTShortcut(savedCombo);
});

app.on('window-all-closed', () => {
  // Unregister global shortcuts
  globalShortcut.unregisterAll();
  // 清理 Deepgram 连接
  isListeningActive = false;
  if (deepgramKeepAlive) { clearInterval(deepgramKeepAlive); deepgramKeepAlive = null; }
  if (deepgramLive) { try { deepgramLive.finish(); } catch (e) {} deepgramLive = null; }
  // 清理 TTS 队列
  ttsQueueManager.reset();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
