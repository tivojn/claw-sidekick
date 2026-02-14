const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // OpenClaw 相关
  getEmails: () => ipcRenderer.invoke('openclaw:getEmails'),
  getDailyBriefing: () => ipcRenderer.invoke('openclaw:getDailyBriefing'),
  executeCommand: (command) => ipcRenderer.invoke('openclaw:executeCommand', command),

  // Deepgram 语音识别
  deepgram: {
    startListening: () => ipcRenderer.invoke('deepgram:startListening'),
    stopListening: () => ipcRenderer.invoke('deepgram:stopListening'),
    sendAudio: (audioData) => ipcRenderer.invoke('deepgram:sendAudio', audioData),
    textToSpeech: (text) => ipcRenderer.invoke('deepgram:textToSpeech', text),

    // 事件监听 - 返回取消函数
    onConnected: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('deepgram:connected', handler);
      return () => ipcRenderer.removeListener('deepgram:connected', handler);
    },
    onTranscript: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('deepgram:transcript', handler);
      return () => ipcRenderer.removeListener('deepgram:transcript', handler);
    },
    onError: (callback) => {
      const handler = (event, error) => callback(error);
      ipcRenderer.on('deepgram:error', handler);
      return () => ipcRenderer.removeListener('deepgram:error', handler);
    },
    onClosed: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('deepgram:closed', handler);
      return () => ipcRenderer.removeListener('deepgram:closed', handler);
    },
    onUtteranceEnd: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('deepgram:utteranceEnd', handler);
      return () => ipcRenderer.removeListener('deepgram:utteranceEnd', handler);
    },

    // 流式 TTS 音频块事件
    onAudioChunk: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('tts:audioChunk', handler);
      return () => ipcRenderer.removeListener('tts:audioChunk', handler);
    },

    // 首个句子事件（用于前端立即显示）
    onFirstSentence: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('clawdbot:firstSentence', handler);
      return () => ipcRenderer.removeListener('clawdbot:firstSentence', handler);
    },

    // 清理所有监听器
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('deepgram:connected');
      ipcRenderer.removeAllListeners('deepgram:transcript');
      ipcRenderer.removeAllListeners('deepgram:error');
      ipcRenderer.removeAllListeners('deepgram:closed');
      ipcRenderer.removeAllListeners('deepgram:utteranceEnd');
      ipcRenderer.removeAllListeners('tts:audioChunk');
      ipcRenderer.removeAllListeners('clawdbot:firstSentence');
    }
  },

  // TTS 音色选择 + Provider 设置
  tts: {
    setVoice: (voiceId) => ipcRenderer.invoke('tts:setVoice', voiceId),
    getVoice: () => ipcRenderer.invoke('tts:getVoice'),
    stop: () => ipcRenderer.invoke('tts:stop'),
    setProvider: (provider) => ipcRenderer.invoke('tts:setProvider', provider),
    getProvider: () => ipcRenderer.invoke('tts:getProvider'),
    setProviderConfig: (provider, config) => ipcRenderer.invoke('tts:setProviderConfig', provider, config),
    getProviderConfig: (provider) => ipcRenderer.invoke('tts:getProviderConfig', provider),
    validateMinimax: (apiKey) => ipcRenderer.invoke('tts:validateMinimax', apiKey),
    setMinimaxVoice: (voiceId) => ipcRenderer.invoke('tts:setMinimaxVoice', voiceId),
    getMinimaxVoice: () => ipcRenderer.invoke('tts:getMinimaxVoice'),
    // Per-avatar TTS
    switchAvatar: (avatarId) => ipcRenderer.invoke('tts:switchAvatar', avatarId),
    setAvatarConfig: (avatarId, config) => ipcRenderer.invoke('tts:setAvatarConfig', avatarId, config),
    getAvatarConfig: (avatarId) => ipcRenderer.invoke('tts:getAvatarConfig', avatarId),
    // MiniMax voice preview
    previewMinimax: (voiceId) => ipcRenderer.invoke('tts:previewMinimax', voiceId)
  },

  // Push to Talk
  ptt: {
    setShortcut: (combo) => ipcRenderer.invoke('ptt:setShortcut', combo),
    onToggle: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('ptt:toggle', handler);
      return () => ipcRenderer.removeListener('ptt:toggle', handler);
    }
  },

  // Connection provider management
  connection: {
    setProvider: (provider) => ipcRenderer.invoke('connection:setProvider', provider),
    getProvider: () => ipcRenderer.invoke('connection:getProvider'),
    setClaudeCodePath: (path) => ipcRenderer.invoke('connection:setClaudeCodePath', path),
    validateClaudeCode: () => ipcRenderer.invoke('connection:validateClaudeCode'),
    // OpenAI
    validateOpenAI: (apiKey) => ipcRenderer.invoke('connection:validateOpenAI', apiKey),
    listOpenAIModels: () => ipcRenderer.invoke('connection:listOpenAIModels'),
    setOpenAIKey: (apiKey) => ipcRenderer.invoke('connection:setOpenAIKey', apiKey),
    // Gemini
    validateGemini: (apiKey) => ipcRenderer.invoke('connection:validateGemini', apiKey),
    listGeminiModels: () => ipcRenderer.invoke('connection:listGeminiModels'),
    setGeminiKey: (apiKey) => ipcRenderer.invoke('connection:setGeminiKey', apiKey),
    // Anthropic
    validateAnthropic: (apiKey) => ipcRenderer.invoke('connection:validateAnthropic', apiKey),
    listAnthropicModels: () => ipcRenderer.invoke('connection:listAnthropicModels'),
    setAnthropicKey: (apiKey) => ipcRenderer.invoke('connection:setAnthropicKey', apiKey),
    // Ollama
    validateOllama: () => ipcRenderer.invoke('connection:validateOllama'),
    listOllamaModels: () => ipcRenderer.invoke('connection:listOllamaModels'),
    // Generic
    setModel: (provider, model) => ipcRenderer.invoke('connection:setModel', provider, model),
    startOAuth: (provider) => ipcRenderer.invoke('connection:startOAuth', provider)
  },

  // STT provider management (Deepgram / Groq Whisper)
  stt: {
    setProvider: (provider) => ipcRenderer.invoke('stt:setProvider', provider),
    getProvider: () => ipcRenderer.invoke('stt:getProvider'),
    validateGroq: (apiKey) => ipcRenderer.invoke('stt:validateGroq', apiKey),
    setGroqModel: (model) => ipcRenderer.invoke('stt:setGroqModel', model),
    transcribeGroq: (audioBase64) => ipcRenderer.invoke('stt:transcribeGroq', audioBase64)
  },

  // 异步任务管理
  task: {
    create: (message) => ipcRenderer.invoke('task:create', message),
    get: (taskId) => ipcRenderer.invoke('task:get', taskId),
    getAll: () => ipcRenderer.invoke('task:getAll'),
    cancel: (taskId) => ipcRenderer.invoke('task:cancel', taskId),

    // 任务完成事件
    onCompleted: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('task-completed', handler);
      return () => ipcRenderer.removeListener('task-completed', handler);
    },

    // 任务失败事件
    onFailed: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('task-failed', handler);
      return () => ipcRenderer.removeListener('task-failed', handler);
    }
  },

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  restoreWindow: () => ipcRenderer.send('window:restore'),
  closeWindow: () => ipcRenderer.send('window:close'),
  setWindowPosition: (x, y) => ipcRenderer.send('window:setPosition', x, y),
  onMiniMode: (callback) => {
    const handler = (event, isMini) => callback(isMini);
    ipcRenderer.on('window:miniMode', handler);
    return () => ipcRenderer.removeListener('window:miniMode', handler);
  },

  // 文件操作
  file: {
    // 在 Finder 中显示文件
    showInFolder: (filePath) => ipcRenderer.invoke('file:showInFolder', filePath)
  }
});
