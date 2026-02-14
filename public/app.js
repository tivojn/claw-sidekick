// ===== App State =====
let appState = 'welcome'; // welcome | idle | listening | thinking | speaking | followup | goodbye
let isFirstLaunch = true;
let isRecording = false;
let isProcessing = false;
let isSpeaking = false;
let audioStream = null;
let audioContext = null;
let audioWorkletNode = null;
let audioPlayer = null;
let followupTimer = null;
let bubbleHideTimer = null;
let auraAnimator = null;
let live2dRenderer = null;
let executeTimer = null;
let accumulatedTranscript = '';
let lastAIResponse = '';
let countdownInterval = null;
let groqAudioChunks = [];
let useGroqSTT = false;

// ===== Character Profiles =====
const CHARACTER_PROFILES = {
  lobster: {
    id: 'lobster',
    name: 'Haru',
    desc: 'Fun & energetic AI buddy',
    icon: 'mdi:fish',
    welcomeText: "Hey! What's up? I'm your AI buddy, hit me up with anything!",
    thinkingPrompts: [
      'Hang on, let me check...',
      'Hmm, thinking about it...',
      'Working on it...',
      'One sec, almost there...',
      'Let me figure this out...',
      'Got it! Processing now...',
      'On it, give me a moment...',
      'Hold tight, answer coming!'
    ],
    model: 'models/haru/haru_greeter_t03.model3.json',
    videos: {
      welcome: 'lobster-welcome.mp4',
      idle: 'lobster-listening.mp4',
      listening: 'lobster-listening.mp4',
      thinking: 'lobster-thinking.mp4',
      speaking: 'lobster-speaking.mp4',
      followup: 'lobster-listening.mp4',
      goodbye: 'lobster-idle.mp4'
    },
    auraColors: {
      idle: { r: 102, g: 126, b: 234 },
      listening: { r: 239, g: 68, b: 68 },
      thinking: { r: 245, g: 158, b: 11 },
      speaking: { r: 118, g: 75, b: 162 }
    },
    defaultVoice: 'en-US-EmmaMultilingualNeural'
  },
  amy: {
    id: 'amy',
    name: 'Octavia',
    desc: 'Warm & witty assistant',
    icon: 'mdi:account-heart',
    welcomeText: "Yo! I'm Octavia, what can I do for ya?",
    thinkingPrompts: [
      'Let me think...',
      'Looking it up for you...',
      'Just a moment...',
      'Let me see...',
      'Sure, on it...',
      'Thinking...',
    ],
    preQueryPrompts: [
      "Sure thing, let me look that up!",
      "Got it, checking now!",
      "On it, one sec!",
      "Alright, let me find out!",
    ],
    model: 'models/mao/Mao.model3.json',
    videos: {
      welcome: 'amy-welcome.mp4',
      idle: 'amy-listening.mp4',
      listening: 'amy-listening.mp4',
      thinking: 'amy-listening.mp4',
      speaking: 'amy-speaking.mp4',
      followup: 'amy-listening.mp4',
      goodbye: 'amy-listening.mp4'
    },
    auraColors: {
      idle: { r: 255, g: 154, b: 162 },
      listening: { r: 255, g: 107, b: 157 },
      thinking: { r: 255, g: 183, b: 178 },
      speaking: { r: 255, g: 134, b: 154 }
    },
    defaultVoice: 'zh-CN-XiaoyiNeural'
  },
  cat: {
    id: 'cat',
    name: 'Zane',
    desc: 'Chill & curious cat helper',
    icon: 'mdi:cat',
    welcomeText: "Meow! Hey there, need a paw with something?",
    thinkingPrompts: [
      'Meow~ let me think...',
      'Thinking, meow~',
      'One moment, meow~',
      'Let me check, meow...',
      'Working hard, meow~',
      'Almost done, meow!',
    ],
    model: 'models/natori/Natori.model3.json',
    videos: {
      welcome: 'cat-welcome.mp4',
      idle: 'cat-idle.mp4',
      listening: 'cat-listening.mp4',
      thinking: 'cat-thinking.mp4',
      speaking: 'cat-speaking.mp4',
      followup: 'cat-listening.mp4',
      goodbye: 'cat-idle.mp4'
    },
    auraColors: {
      idle: { r: 255, g: 183, b: 77 },
      listening: { r: 255, g: 107, b: 107 },
      thinking: { r: 255, g: 213, b: 79 },
      speaking: { r: 171, g: 130, b: 255 }
    },
    defaultVoice: 'en-US-BrianMultilingualNeural'
  },
  robot: {
    id: 'robot',
    name: 'Mecha',
    desc: 'Precise & efficient robot',
    icon: 'mdi:robot',
    welcomeText: "Systems online. What's the mission?",
    thinkingPrompts: [
      'Analyzing data...',
      'Computing...',
      'Retrieving info...',
      'System processing, standby...',
      'Running analysis...',
      'Crunching numbers...',
    ],
    model: 'models/hiyori/Hiyori.model3.json',
    videos: {
      welcome: 'robot-welcome.mp4',
      idle: 'robot-idle.mp4',
      listening: 'robot-listening.mp4',
      thinking: 'robot-thinking.mp4',
      speaking: 'robot-speaking.mp4',
      followup: 'robot-listening.mp4',
      goodbye: 'robot-idle.mp4'
    },
    auraColors: {
      idle: { r: 0, g: 200, b: 255 },
      listening: { r: 0, g: 255, b: 150 },
      thinking: { r: 255, g: 200, b: 0 },
      speaking: { r: 0, g: 150, b: 255 }
    },
    defaultVoice: 'en-US-BrianMultilingualNeural'
  }
};

let currentCharacter = CHARACTER_PROFILES.amy;

// Current character video state mapping
let VIDEO_SOURCES = { ...currentCharacter.videos };

// Follow-up timeout (30s no response → idle)
const FOLLOWUP_TIMEOUT = 30000;
// Bubble auto-hide time
const BUBBLE_AUTO_HIDE = 25000;
// Execute delay after user pause
const EXECUTE_DELAY = 3000;

// 处理中的提示语从当前角色配置获取
function getThinkingPrompts() {
  return currentCharacter.thinkingPrompts;
}

// ===== DOM 元素 =====
const speechBubble = document.getElementById('speech-bubble');
const bubbleText = document.getElementById('bubble-text');
const statusHint = document.getElementById('status-hint');
const lobsterArea = document.getElementById('lobster-area');
const stateIndicator = document.getElementById('state-indicator');
const stateDot = stateIndicator.querySelector('.state-dot');
const stateText = document.getElementById('state-text');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const tapHint = document.getElementById('tap-hint');
const listeningPulseRing = document.getElementById('listening-pulse-ring');
const foldToggle = document.getElementById('fold-toggle');
const bottomPanel = document.getElementById('bottom-panel');

// ===== Avatar visibility (hide during settings panels) =====
function setAvatarVisible(visible) {
  const live2dCanvas = document.getElementById('live2d-canvas');
  const auraCanvas = document.getElementById('aura-canvas');
  if (live2dCanvas) live2dCanvas.style.display = visible ? '' : 'none';
  if (auraCanvas) auraCanvas.style.display = visible ? '' : 'none';
}

function isAnyPanelOpen() {
  const ttsPanel = document.getElementById('tts-settings-panel');
  const globalPanel = document.getElementById('global-settings-panel');
  return (ttsPanel && ttsPanel.style.display !== 'none') ||
         (globalPanel && globalPanel.style.display !== 'none');
}

function onPanelOpen() {
  setAvatarVisible(false);
}

function onPanelClose() {
  if (!isAnyPanelOpen()) {
    setAvatarVisible(true);
  }
}

// ===== 初始化光环动画 + Live2D =====
document.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('aura-canvas');
  if (canvas && window.OrbAnimator) {
    auraAnimator = new OrbAnimator(canvas);
  }

  // Initialize Live2D renderer
  if (window.Live2DRenderer) {
    live2dRenderer = new Live2DRenderer(lobsterArea);
    // Load the current character's model
    if (currentCharacter.model) {
      await live2dRenderer.loadModel(currentCharacter.model);
    }
  }

  initDeepgramListeners();
  initVoice();
  initTaskListeners();
  initMiniMode();
  initStreamingTTS();  // 初始化流式 TTS 监听
  initFilePathClickHandler();  // 初始化文件路径点击处理
  initPTTToggle();  // Listen for global PTT shortcut from main process

  // Load STT provider at startup so PTT uses correct provider
  try {
    const stt = await window.electronAPI.stt.getProvider();
    settingsState.sttProvider = stt.provider || 'deepgram';
    settingsState.groqModel = stt.groqModel || 'whisper-large-v3-turbo';
    console.log('[App] STT provider loaded:', settingsState.sttProvider);
  } catch (e) {
    console.warn('[App] Failed to load STT provider, defaulting to deepgram');
  }

  // 首次启动播放欢迎动画
  if (isFirstLaunch) {
    playWelcomeVideo();
  }

  console.log('[App] 已初始化');
});

// ===== 初始化任务监听器 =====
function initTaskListeners() {
  // 监听任务完成
  window.electronAPI.task.onCompleted((data) => {
    console.log('[App] 任务完成:', data.taskId);

    const cleanResult = cleanMarkdown(data.result);

    // 显示完成通知气泡
    showBubble(`Done! ${cleanResult}`);

    playTextToSpeech(`Task complete! ${cleanResult}`).catch(err => {
      console.warn('[App] Task completion TTS failed:', err);
    });

    // 切换到 speaking 状态
    setAppState('speaking');

    // 语音播放完后回到 idle
    setTimeout(() => {
      if (appState === 'speaking') {
        setAppState('idle');
      }
    }, 5000);
  });

  // 监听任务失败
  window.electronAPI.task.onFailed((data) => {
    console.error('[App] 任务失败:', data.taskId, data.error);

    const cleanError = cleanMarkdown(data.error);

    // 显示失败通知
    showBubble(`Failed: ${cleanError}`);

    playTextToSpeech(`Sorry, task failed: ${cleanError}`).catch(err => {
      console.warn('[App] Task failure TTS failed:', err);
    });
  });
}

// ===== 状态管理 =====
function setAppState(newState) {
  appState = newState;
  clearTimeout(followupTimer);

  stateDot.className = 'state-dot';
  statusHint.className = 'status-hint';

  // 控制点击引导和脉冲环
  if (newState === 'listening' || newState === 'speaking') {
    tapHint.classList.add('hidden');
  } else {
    tapHint.classList.remove('hidden');
  }
  if (newState === 'listening' || newState === 'followup') {
    listeningPulseRing.classList.remove('hidden');
  } else {
    listeningPulseRing.classList.add('hidden');
  }

  // Update Live2D model state
  if (live2dRenderer) {
    live2dRenderer.setState(newState);
  }

  switch (newState) {
    case 'welcome':
      stateText.textContent = `Welcome to ${currentCharacter.name}`;
      statusHint.textContent = '';
      break;
    case 'idle':
      stateText.textContent = 'Type to start chatting';
      statusHint.textContent = '';
      break;
    case 'listening':
      stateDot.classList.add('listening');
      stateText.textContent = 'Speak now...';
      statusHint.textContent = '';
      break;
    case 'thinking':
      stateDot.classList.add('thinking');
      stateText.textContent = 'Analyzing your question...';
      statusHint.textContent = '';
      showBubble('<div class="thinking-dots"><span></span><span></span><span></span></div>', false);
      break;
    case 'speaking':
      stateDot.classList.add('speaking');
      stateText.textContent = 'Replying...';
      statusHint.textContent = '';
      break;
    case 'followup':
      stateDot.classList.add('listening');
      stateText.textContent = 'Ask me anything else';
      statusHint.textContent = '';
      followupTimer = setTimeout(() => {
        console.log('[App] Follow-up timeout, going idle');
        stopRecording().then(() => {
          setAppState('idle');
          hideBubble(2000);
        });
      }, FOLLOWUP_TIMEOUT);
      break;
    case 'goodbye':
      stateText.textContent = 'Catch you later!';
      statusHint.textContent = '';
      break;
  }

  // 同步光环动画状态
  if (auraAnimator) {
    const orbState = newState === 'followup' ? 'listening' : newState;
    auraAnimator.setState(orbState);
  }

  // 同步悬浮球状态
  if (isMiniMode) {
    setMiniOrbState(newState);
  }
}

// ===== 播放欢迎动画 =====
function playWelcomeVideo() {
  console.log('[App] Playing welcome animation');
  setAppState('welcome');

  // Live2D welcome motion is triggered by setState('welcome')
  // After a few seconds, transition to idle
  setTimeout(() => {
    if (appState === 'welcome') {
      isFirstLaunch = false;
      setAppState('idle');
    }
  }, 4000);

  // Play welcome TTS
  playWelcomeAudioFallback();
}

// ===== 播放欢迎语音（兜底：视频无法有声播放时使用TTS） =====
async function playWelcomeAudioFallback() {
  try {
    await playTextToSpeech(currentCharacter.welcomeText);
  } catch (error) {
    console.warn('[App] 欢迎语音TTS兜底播放失败:', error);
  }
}

// ===== 气泡显示 =====
function showBubble(content, isUserSpeech = false) {
  clearTimeout(bubbleHideTimer);
  speechBubble.style.display = 'block';

  if (isUserSpeech) {
    speechBubble.className = 'speech-bubble user-speech';
    bubbleText.innerHTML = content;
  } else {
    speechBubble.className = 'speech-bubble ai-response';
    // 检测文件路径并转换为可点击链接
    bubbleText.innerHTML = linkifyFilePaths(content);
  }

  // 自动隐藏
  bubbleHideTimer = setTimeout(() => {
    hideBubble();
  }, BUBBLE_AUTO_HIDE);
}

// 打字机效果显示 AI 回复
function showBubbleWithTyping(content) {
  clearTimeout(bubbleHideTimer);
  speechBubble.style.display = 'block';
  speechBubble.className = 'speech-bubble ai-response';
  bubbleText.innerHTML = '';

  let index = 0;
  const typingSpeed = 30; // 每个字符的延迟（毫秒）

  function typeNextChar() {
    if (index < content.length) {
      bubbleText.innerHTML += content.charAt(index);
      index++;
      setTimeout(typeNextChar, typingSpeed);
    } else {
      // 打字完成后追加查看全文按钮
      appendViewTextBtn(content);
      // 自动隐藏
      bubbleHideTimer = setTimeout(() => {
        hideBubble();
      }, BUBBLE_AUTO_HIDE);
    }
  }

  typeNextChar();
}

// 带查看文本按钮的气泡（用于打断后展示）
function showBubbleWithViewBtn(fullText, isInterrupted = false) {
  clearTimeout(bubbleHideTimer);
  speechBubble.style.display = 'block';
  speechBubble.className = 'speech-bubble ai-response';

  const preview = fullText.length > 40 ? fullText.substring(0, 40) + '...' : fullText;
  const label = isInterrupted ? 'Interrupted — tap to see full reply' : 'Tap to see full reply';

  bubbleText.innerHTML = `<span class="bubble-preview">${escapeHtml(preview)}</span>`;
  appendViewTextBtn(fullText, label);

  bubbleHideTimer = setTimeout(() => {
    hideBubble();
  }, BUBBLE_AUTO_HIDE * 2); // 打断后给更长的展示时间
}

// 追加"查看全文"按钮到气泡底部 (only for 5+ lines worth of text)
function appendViewTextBtn(fullText, label) {
  if (!fullText || fullText.length < 120) return; // only show for longer text (~5+ lines)

  const btnWrap = document.createElement('div');
  btnWrap.className = 'view-text-btn-wrap';
  btnWrap.innerHTML = `<button class="view-text-btn">${label || 'View full text'}</button>`;
  bubbleText.appendChild(btnWrap);

  btnWrap.querySelector('.view-text-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openTextViewer(fullText);
  });
}

// 全文查看浮层
function openTextViewer(text) {
  // 移除已有的浮层
  const existing = document.getElementById('text-viewer');
  if (existing) existing.remove();

  const viewer = document.createElement('div');
  viewer.id = 'text-viewer';
  viewer.className = 'text-viewer';
  viewer.innerHTML = `
    <div class="text-viewer-header">
      <span class="text-viewer-title">Full Reply</span>
      <button class="text-viewer-close" id="text-viewer-close">×</button>
    </div>
    <div class="text-viewer-body">${escapeHtml(text)}</div>
  `;

  document.querySelector('.widget-container').appendChild(viewer);

  viewer.querySelector('#text-viewer-close').addEventListener('click', (e) => {
    e.stopPropagation();
    viewer.classList.add('closing');
    setTimeout(() => viewer.remove(), 250);
  });
}

function hideBubble(delay) {
  if (delay) {
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => {
      fadeOutBubble();
    }, delay);
  } else {
    fadeOutBubble();
  }
}

function fadeOutBubble() {
  speechBubble.style.transition = 'opacity 0.3s ease-out';
  speechBubble.style.opacity = '0';
  setTimeout(() => {
    speechBubble.style.display = 'none';
    speechBubble.style.opacity = '1';
    speechBubble.style.transition = '';
  }, 300);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 清理 markdown 格式符号（**加粗**、*斜体*、~~删除线~~ 等）
function cleanMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // **加粗**
    .replace(/\*(.+?)\*/g, '$1')      // *斜体*
    .replace(/~~(.+?)~~/g, '$1')      // ~~删除线~~
    .replace(/`(.+?)`/g, '$1');       // `代码`
}

// 检测文本中的文件路径并转换为可点击链接
function linkifyFilePaths(text) {
  if (!text) return text;

  // 文件路径正则表达式（更宽松的匹配）
  // 匹配: ~/xxx, /Users/xxx, /home/xxx 等
  // 支持中文、空格、各种特殊字符
  const filePathRegex = /(~\/[^\s`'"<>|]+|\/(?:Users|home|System|Applications|Library|tmp|var|etc)[^\s`'"<>|]*)/g;

  return text.replace(filePathRegex, (match) => {
    // 清理末尾的标点符号
    let cleanPath = match.replace(/[。，,；;！!？?）)\]]+$/g, '');

    // 创建可点击的链接
    return `<span class="file-path" data-path="${escapeHtml(cleanPath)}" title="Show in Finder">${escapeHtml(cleanPath)}</span>`;
  });
}

// 打断当前任务（查询或播放）
function interruptCurrentTask() {
  console.log('[App] 打断当前任务');

  // 设置中断标志
  isProcessing = false;

  // 中断 TTS
  interruptTTS();

  // 清空音频队列
  audioQueue = [];
  isPlayingQueue = false;
  streamingTextBuffer = '';

  // 重置状态
  setAppState('idle');
  showBubble('Interrupted');
}

// 初始化文件路径点击事件监听
function initFilePathClickHandler() {
  document.addEventListener('click', async (e) => {
    const pathElement = e.target.closest('.file-path');
    if (pathElement) {
      e.stopPropagation();
      const filePath = pathElement.dataset.path;

      console.log('[File] 点击文件路径:', filePath);

      try {
        const result = await window.electronAPI.file.showInFolder(filePath);
        if (result.success) {
          // 显示成功反馈
          pathElement.classList.add('clicked');
          setTimeout(() => pathElement.classList.remove('clicked'), 500);
        } else {
          console.warn('[File] 打开失败:', result.error);
          // 显示错误提示
          showBubble(`Can't open path: ${result.error}`);
        }
      } catch (err) {
        console.error('[File] 调用失败:', err);
      }
    }
  });
}

// ===== PTT Toggle (from Electron globalShortcut) =====
function initPTTToggle() {
  if (!window.electronAPI || !window.electronAPI.ptt) return;
  window.electronAPI.ptt.onToggle(() => {
    console.log('[PTT] Global shortcut triggered, state:', appState);
    if (appState === 'idle' || appState === 'followup') {
      accumulatedTranscript = '';
      setAppState('listening');
      startRecording();
    } else if (appState === 'listening') {
      stopRecording().then((transcript) => {
        if (transcript) {
          showBubble('🎤 ' + escapeHtml(transcript), true);
          handleCommand(transcript);
        } else if (accumulatedTranscript.trim()) {
          const cmd = accumulatedTranscript;
          accumulatedTranscript = '';
          handleCommand(cmd);
        } else {
          setAppState('idle');
        }
      });
    } else if (appState === 'speaking') {
      interruptTTS();
      isProcessing = false;
      setAppState('idle');
    }
  });
}

// ===== Deepgram 事件监听 =====
function initDeepgramListeners() {
  window.electronAPI.deepgram.removeAllListeners();

  window.electronAPI.deepgram.onConnected(() => {
    console.log('[App] Deepgram 已连接');
  });

  window.electronAPI.deepgram.onTranscript((data) => {
    const { transcript, isFinal } = data;
    console.log(`[App] 识别 [${isFinal ? '最终' : '临时'}]: "${transcript}"`);

    if (isFinal) {
      if (transcript.trim().length > 0) {
        // 累积识别结果
        if (accumulatedTranscript.length > 0) {
          accumulatedTranscript += ' ' + transcript.trim();
        } else {
          accumulatedTranscript = transcript.trim();
        }

        // 显示累积的用户语音
        showBubble('🎤 ' + escapeHtml(accumulatedTranscript), true);

        // 清除之前的执行定时器
        clearTimeout(executeTimer);

        // 延迟执行：等待用户停顿后执行命令（utterance_end 事件可提前触发）
        executeTimer = setTimeout(() => {
          console.log('[App] 用户停顿超时，执行命令');
          clearInterval(countdownInterval);
          const commandToExecute = accumulatedTranscript;
          accumulatedTranscript = '';

          stopRecording().then(() => {
            handleCommand(commandToExecute);
          });
        }, EXECUTE_DELAY);

        // 倒计时显示
        let countdown = Math.ceil(EXECUTE_DELAY / 1000);
        clearInterval(countdownInterval);
        statusHint.textContent = `Executing in ${countdown}s... keep talking to reset`;
        countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            statusHint.textContent = `Executing in ${countdown}s... keep talking to reset`;
          } else {
            clearInterval(countdownInterval);
          }
        }, 1000);
      }
    } else {
      // 实时显示识别中的文字
      if (transcript.trim().length > 0) {
        statusHint.textContent = transcript + '...';
      }
    }
  });

  // 监听语音结束事件（Deepgram 检测到用户停止说话）
  window.electronAPI.deepgram.onUtteranceEnd(() => {
    console.log('[App] 检测到语音结束');
    if (accumulatedTranscript.trim().length > 0) {
      // 用户有有效语音且已停止说话，立即执行
      clearTimeout(executeTimer);
      clearInterval(countdownInterval);
      console.log('[App] 语音结束，立即执行命令');
      const commandToExecute = accumulatedTranscript;
      accumulatedTranscript = '';
      stopRecording().then(() => {
        handleCommand(commandToExecute);
      });
    }
  });

  window.electronAPI.deepgram.onError((error) => {
    console.error('[App] Deepgram 错误:', error);
    stopRecording();
    setAppState('idle');
    showBubble('Recognition error, tap me to try again');
  });

  window.electronAPI.deepgram.onClosed(() => {
    console.log('[App] Deepgram 连接关闭');
  });
}

// ===== 中断 TTS =====
// 流式 TTS 音频队列
let audioQueue = [];
let isPlayingQueue = false;
let streamingTextBuffer = '';
let streamingChunksReceived = 0; // track if streaming TTS sent any chunks

function interruptTTS() {
  // 停止当前播放
  if (audioPlayer) {
    try {
      audioPlayer.onended = null;
      audioPlayer.pause();
    } catch (e) { /* ignore */ }
    audioPlayer = null;
  }
  // 清空队列
  audioQueue = [];
  isPlayingQueue = false;
  streamingTextBuffer = '';
  isSpeaking = false;
  // Stop Live2D lip sync
  if (live2dRenderer) {
    live2dRenderer.stopSpeaking();
  }
  // 通知主进程停止 TTS 生成
  window.electronAPI.tts.stop();
}

// ===== 流式 TTS 初始化 =====
function initStreamingTTS() {
  // 监听音频块
  window.electronAPI.deepgram.onAudioChunk(async (data) => {
    console.log(`[TTS] 收到音频块 #${data.sentenceId}`);
    streamingChunksReceived++;

    audioQueue.push(data);

    if (!isPlayingQueue) {
      await processAudioQueue();
    }
  });

  // 监听首个句子（切换状态，但不提前显示文本）
  window.electronAPI.deepgram.onFirstSentence((data) => {
    console.log('[TTS] 首句到达，准备播放');
    // 切换到 speaking 状态
    if (appState === 'thinking') {
      setAppState('speaking');
    }
    // 不提前显示文本，等音频播放时再显示
  });
}

// 处理音频队列
async function processAudioQueue() {
  if (isPlayingQueue || audioQueue.length === 0) return;

  isPlayingQueue = true;

  while (audioQueue.length > 0) {
    const item = audioQueue.shift();

    // 播放音频（音频开始播放时才显示文本）
    await playAudioChunk(item.audio, item.text);
  }

  isPlayingQueue = false;
  isSpeaking = false;

  // TTS 播放完毕，回到 idle
  // Always reset isProcessing when streaming finishes to prevent stuck state
  if (appState === 'speaking' || isProcessing) {
    isProcessing = false;
    if (appState === 'speaking') {
      setAppState('idle');
      textInput.focus();
    }
  }
}

// 播放单个音频块（音频开始播放时才显示对应文本 + Live2D lip sync）
function playAudioChunk(audioBase64, text) {
  return new Promise((resolve) => {
    const audioDataUrl = 'data:audio/mp3;base64,' + audioBase64;
    const audio = new Audio(audioDataUrl);

    // 音频开始播放时才显示文本 + start lip sync
    audio.onplay = () => {
      // 追加文本到缓冲区并更新显示
      if (streamingTextBuffer && !streamingTextBuffer.includes(text)) {
        streamingTextBuffer += text;
      } else {
        streamingTextBuffer = text;
      }
      showBubble(escapeHtml(streamingTextBuffer));

      // Start Live2D lip sync with simulated mouth movement
      if (live2dRenderer) {
        live2dRenderer._startSimulatedLipSync();
      }
    };

    audio.onended = () => {
      // Stop lip sync when audio chunk ends
      if (live2dRenderer) {
        live2dRenderer.stopSpeaking();
      }
      resolve();
    };

    audio.onerror = () => {
      if (live2dRenderer) {
        live2dRenderer.stopSpeaking();
      }
      resolve();
    };

    audio.play().catch(() => resolve());

    audioPlayer = audio;
  });
}

// ===== PCM to WAV conversion (for Groq batch STT) =====
function pcmToWavBase64(pcmData, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcmData);
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ===== 录音控制 =====
async function startRecording() {
  if (isRecording || isProcessing) return;

  try {
    interruptTTS();

    useGroqSTT = settingsState.sttProvider === 'groq';

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    });

    if (useGroqSTT) {
      // Groq batch mode: collect audio locally
      groqAudioChunks = [];
      console.log('[STT] Using Groq Whisper (batch mode)');
    } else {
      // Deepgram streaming mode
      const result = await window.electronAPI.deepgram.startListening();
      if (!result.success) {
        showBubble('Speech recognition failed to start');
        setAppState('idle');
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
        return;
      }
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });

    await audioContext.audioWorklet.addModule('audio-processor.js');
    const source = audioContext.createMediaStreamSource(audioStream);
    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

    audioWorkletNode.port.onmessage = (event) => {
      if (isRecording && event.data) {
        if (useGroqSTT) {
          groqAudioChunks.push(new Uint8Array(event.data));
        } else {
          window.electronAPI.deepgram.sendAudio(new Uint8Array(event.data));
        }
      }
    };

    source.connect(audioWorkletNode);
    isRecording = true;

  } catch (error) {
    console.error('[App] 录音失败:', error);
    setAppState('idle');
    if (error.name === 'NotAllowedError') {
      showBubble('Please allow microphone access');
    } else if (error.name === 'NotFoundError') {
      showBubble('No microphone detected');
    } else {
      showBubble('Recording failed: ' + error.message);
    }
  }
}

// Returns transcript string for Groq mode, null for Deepgram (events handle it)
async function stopRecording() {
  if (!isRecording) return null;

  const wasGroq = useGroqSTT;
  isRecording = false;

  // 清除执行定时器和倒计时
  clearTimeout(executeTimer);
  clearInterval(countdownInterval);
  executeTimer = null;

  if (audioWorkletNode) {
    audioWorkletNode.disconnect();
    try { audioWorkletNode.port.close(); } catch (e) {}
    audioWorkletNode = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
    audioContext = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  if (wasGroq && groqAudioChunks.length > 0) {
    // Concatenate PCM chunks → WAV → send to Groq
    const totalLen = groqAudioChunks.reduce((s, c) => s + c.length, 0);
    const pcm = new Uint8Array(totalLen);
    let off = 0;
    for (const chunk of groqAudioChunks) { pcm.set(chunk, off); off += chunk.length; }
    groqAudioChunks = [];

    showBubble('Transcribing...');
    try {
      const wavBase64 = pcmToWavBase64(pcm, 16000);
      const result = await window.electronAPI.stt.transcribeGroq(wavBase64);
      if (result.success && result.text && result.text.trim()) {
        console.log('[STT] Groq transcript:', result.text.trim());
        return result.text.trim();
      } else {
        showBubble('Could not understand, try again');
        setAppState('idle');
        return null;
      }
    } catch (e) {
      console.error('[STT] Groq transcription failed:', e);
      showBubble('Transcription failed');
      setAppState('idle');
      return null;
    }
  } else {
    await window.electronAPI.deepgram.stopListening();
    return null; // Deepgram handles transcript via events
  }
}

// ===== 点击角色区域 → 聚焦文本输入 (voice disabled, text-only mode) =====
async function onLobsterClick() {
  // speaking 状态下允许打断
  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    if (lastAIResponse) {
      showBubbleWithViewBtn(lastAIResponse, true);
    }
    setAppState('idle');
    textInput.focus();
    return;
  }

  // thinking 状态下允许打断
  if (appState === 'thinking') {
    console.log('[App] Interrupting query');
    interruptCurrentTask();
    return;
  }

  if (isProcessing) return;

  // Focus text input on click
  textInput.focus();
}

// ===== 处理命令 =====
async function handleCommand(command) {
  if (isProcessing) return;

  // 检测是否是异步任务
  const asyncKeywords = ['later', 'when done', 'let me know', 'notify me', 'tell me when', 'in the background'];
  const isAsyncTask = asyncKeywords.some(keyword => command.includes(keyword));

  // 检测是否是告别语
  const goodbyeKeywords = ['bye', 'goodbye', 'see ya', 'later', 'quit', 'exit', 'close'];
  const isGoodbye = goodbyeKeywords.some(keyword =>
    command.toLowerCase().includes(keyword)
  );

  if (isAsyncTask) {
    // 异步任务处理
    await handleAsyncTask(command);
  } else {
    // 同步任务处理
    await handleSyncTask(command, isGoodbye);
  }
}

// ===== 处理异步任务 =====
async function handleAsyncTask(command) {
  isProcessing = true;

  try {
    // 创建异步任务
    const result = await window.electronAPI.task.create(command);

    if (result.success) {
      console.log(`[App] 创建异步任务: ${result.taskId}`);

      // 立即反馈
      const feedbackMessages = [
        "On it! I'll let you know when it's done.",
        "Got it! Working on it in the background.",
        "Sure, I'll handle it and get back to you.",
        "No worries, I'll take care of it!",
      ];
      const feedback = feedbackMessages[Math.floor(Math.random() * feedbackMessages.length)];

      showBubble(feedback);
      await playTextToSpeech(feedback);

      setAppState('idle');
    }
  } catch (error) {
    console.error('[App] 创建异步任务失败:', error);
    showBubble('Failed to create task, try again');
    setAppState('idle');
  } finally {
    isProcessing = false;
  }
}

// ===== 处理同步任务 =====
async function handleSyncTask(command, isGoodbye) {
  isProcessing = true;

  setAppState('thinking');

  // 如果当前角色有 preQueryPrompts，先播放提示语再执行查询
  if (currentCharacter.preQueryPrompts && currentCharacter.preQueryPrompts.length > 0) {
    const prePrompt = currentCharacter.preQueryPrompts[Math.floor(Math.random() * currentCharacter.preQueryPrompts.length)];
    showBubble(prePrompt);
    // 播放提示语（非流式 TTS）
    await playTextToSpeech(prePrompt);
  } else {
    // 其他角色显示思考提示
    const prompts = getThinkingPrompts();
    const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
    showBubble(randomPrompt);
  }

  // 重置流式 TTS 状态
  streamingTextBuffer = '';
  audioQueue = [];
  isPlayingQueue = false;
  isSpeaking = true;
  streamingChunksReceived = 0;

  try {
    const result = await window.electronAPI.executeCommand(command);

    // 清理 markdown 符号
    const cleanedMessage = cleanMarkdown(result.message);

    // 缓存 AI 回复（用于打断后查看）
    lastAIResponse = cleanedMessage;

    // Only use non-streaming fallback if NO streaming chunks were received at all
    // (streamingChunksReceived tracks this to avoid race conditions with slow TTS providers)
    if (streamingChunksReceived === 0 && audioQueue.length === 0 && !isPlayingQueue) {
      // No streaming audio received — use traditional TTS
      setAppState('speaking');
      showBubbleWithViewBtn(cleanedMessage);
      await playTextToSpeech(cleanedMessage);

      showBubbleWithTyping(escapeHtml(cleanedMessage));

      if (isGoodbye) {
        setAppState('goodbye');
        isProcessing = false;
        setTimeout(() => { setAppState('idle'); }, 3000);
      } else {
        isProcessing = false;
        setAppState('idle');
        textInput.focus();
      }
    } else if (isGoodbye) {
      // Streaming was used but it's a goodbye
      setAppState('goodbye');
      isProcessing = false;
      setTimeout(() => { setAppState('idle'); }, 3000);
    }
    // Otherwise: streaming TTS handles state transition in processAudioQueue

  } catch (error) {
    console.error('[App] 处理失败:', error);
    showBubble('Oops, something went wrong. Try again!');
    setAppState('idle');
    isProcessing = false;
    isSpeaking = false;
  }
}

// ===== TTS 播放 =====
async function playTextToSpeech(text) {
  if (isSpeaking && audioPlayer) interruptTTS();

  try {
    isSpeaking = true;
    const result = await window.electronAPI.deepgram.textToSpeech(text);

    if (!result.success) {
      console.warn('[App] TTS failed:', result.error);
      isSpeaking = false;
      return;
    }

    const audioDataUrl = 'data:audio/mp3;base64,' + result.audio;

    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer = null;
    }

    audioPlayer = new Audio(audioDataUrl);

    return new Promise((resolve) => {
      audioPlayer.onplay = () => {
        // Start Live2D lip sync
        if (live2dRenderer) {
          live2dRenderer._startSimulatedLipSync();
        }
      };

      audioPlayer.onended = () => {
        isSpeaking = false;
        audioPlayer = null;
        if (live2dRenderer) {
          live2dRenderer.stopSpeaking();
        }
        resolve();
      };

      audioPlayer.onerror = (e) => {
        console.error('[App] TTS playback error:', e);
        isSpeaking = false;
        audioPlayer = null;
        if (live2dRenderer) {
          live2dRenderer.stopSpeaking();
        }
        resolve();
      };

      audioPlayer.play().catch((err) => {
        console.error('[App] TTS play() failed:', err);
        isSpeaking = false;
        audioPlayer = null;
        if (live2dRenderer) {
          live2dRenderer.stopSpeaking();
        }
        resolve();
      });
    });
  } catch (error) {
    console.error('[App] TTS failed:', error);
    isSpeaking = false;
    audioPlayer = null;
  }
}

// ===== 音色选择 =====

// Edge-TTS 音色列表（中文 + 英文）
const VOICE_OPTIONS = [
  // ===== 推荐（多语言） =====
  { group: 'Multilingual (Recommended)', lang: 'all', voices: [
    { id: 'en-US-EmmaMultilingualNeural',   icon: 'mdi:star-four-points', name: 'Emma',      desc: 'Cheerful & youthful', gender: 'female' },
    { id: 'en-US-AvaMultilingualNeural',    icon: 'mdi:flower', name: 'Ava',       desc: 'Caring & expressive', gender: 'female' },
    { id: 'en-US-AndrewMultilingualNeural', icon: 'mdi:account', name: 'Andrew',    desc: 'Warm & confident', gender: 'male' },
    { id: 'en-US-BrianMultilingualNeural',  icon: 'mdi:emoticon-happy', name: 'Brian',     desc: 'Casual & sincere', gender: 'male' },
  ]},
  { group: 'Chinese Female', lang: 'zh', voices: [
    { id: 'zh-CN-XiaoxiaoNeural',    icon: 'mdi:ribbon', name: 'Xiaoxiao',   desc: 'Sweet & lively', gender: 'female' },
    { id: 'zh-CN-XiaoyiNeural',      icon: 'mdi:face-woman-shimmer', name: 'Xiaoyi',    desc: 'Soft & friendly', gender: 'female' },
    { id: 'zh-CN-XiaochenNeural',    icon: 'mdi:flower', name: 'Xiaochen',  desc: 'Elegant & smart', gender: 'female' },
    { id: 'zh-CN-XiaohanNeural',     icon: 'mdi:cloud', name: 'Xiaohan',   desc: 'Warm & healing', gender: 'female' },
    { id: 'zh-CN-XiaomengNeural',    icon: 'mdi:candy', name: 'Xiaomeng',  desc: 'Cute & sweet', gender: 'female' },
    { id: 'zh-CN-XiaomoNeural',      icon: 'mdi:sparkles', name: 'Xiaomo',    desc: 'Gentle & artsy', gender: 'female' },
    { id: 'zh-CN-XiaoqiuNeural',     icon: 'mdi:book-open-page-variant', name: 'Xiaoqiu',  desc: 'Mature & wise', gender: 'female' },
    { id: 'zh-CN-XiaoruiNeural',     icon: 'mdi:school', name: 'Xiaorui',   desc: 'Calm & pro', gender: 'female' },
    { id: 'zh-CN-XiaoshuangNeural',  icon: 'mdi:baby-face', name: 'Xiaoshuang',desc: 'Child voice', gender: 'female' },
    { id: 'zh-CN-XiaoxuanNeural',    icon: 'mdi:crown', name: 'Xiaoxuan',  desc: 'Vibrant & bold', gender: 'female' },
    { id: 'zh-CN-XiaozhenNeural',    icon: 'mdi:television', name: 'Xiaozhen', desc: 'News anchor', gender: 'female' },
  ]},
  { group: 'Chinese Male', lang: 'zh', voices: [
    { id: 'zh-CN-YunxiNeural',       icon: 'mdi:account', name: 'Yunxi',     desc: 'Bright & youthful', gender: 'male' },
    { id: 'zh-CN-YunjianNeural',     icon: 'mdi:sword-cross', name: 'Yunjian',   desc: 'Strong & steady', gender: 'male' },
    { id: 'zh-CN-YunyangNeural',     icon: 'mdi:television', name: 'Yunyang',   desc: 'News anchor', gender: 'male' },
    { id: 'zh-CN-YunyeNeural',       icon: 'mdi:book-open', name: 'Yunye',     desc: 'Narrator', gender: 'male' },
    { id: 'zh-CN-YunzeNeural',       icon: 'mdi:hat-fedora', name: 'Yunze',     desc: 'Refined & calm', gender: 'male' },
    { id: 'zh-CN-YunhaoNeural',      icon: 'mdi:microphone', name: 'Yunhao',    desc: 'Deep & rich', gender: 'male' },
    { id: 'zh-CN-YunfengNeural',     icon: 'mdi:arm-flex', name: 'Yunfeng',   desc: 'Bold & decisive', gender: 'male' },
  ]},
  // ===== English Female =====
  { group: 'English Female', lang: 'en', voices: [
    { id: 'en-US-JennyNeural',       icon: 'mdi:star-four-points', name: 'Jenny',     desc: 'Friendly & warm', gender: 'female' },
    { id: 'en-US-AriaNeural',        icon: 'mdi:flower', name: 'Aria',      desc: 'Expressive & clear', gender: 'female' },
    { id: 'en-US-SaraNeural',        icon: 'mdi:ribbon', name: 'Sara',      desc: 'Gentle & soft', gender: 'female' },
    { id: 'en-US-MichelleNeural',    icon: 'mdi:briefcase', name: 'Michelle', desc: 'Professional', gender: 'female' },
    { id: 'en-GB-SoniaNeural',       icon: 'mdi:crown', name: 'Sonia (UK)',desc: 'British elegance', gender: 'female' },
    { id: 'en-GB-LibbyNeural',       icon: 'mdi:coffee', name: 'Libby (UK)',desc: 'Warm British', gender: 'female' },
  ]},
  // ===== English Male =====
  { group: 'English Male', lang: 'en', voices: [
    { id: 'en-US-GuyNeural',         icon: 'mdi:emoticon-happy', name: 'Guy',       desc: 'Casual & clear', gender: 'male' },
    { id: 'en-US-DavisNeural',       icon: 'mdi:microphone', name: 'Davis',     desc: 'Deep & composed', gender: 'male' },
    { id: 'en-US-TonyNeural',        icon: 'mdi:sunglasses', name: 'Tony',      desc: 'Relaxed & natural', gender: 'male' },
    { id: 'en-US-JasonNeural',       icon: 'mdi:tie', name: 'Jason',     desc: 'Business tone', gender: 'male' },
    { id: 'en-GB-RyanNeural',        icon: 'mdi:hat-fedora', name: 'Ryan (UK)', desc: 'British gentleman', gender: 'male' },
    { id: 'en-AU-WilliamNeural',     icon: 'mdi:weather-sunny', name: 'William (AU)',desc: 'Aussie friendly', gender: 'male' },
  ]},
];

let currentSelectedVoice = 'en-US-EmmaMultilingualNeural';
let previewingVoice = null;

// Voice rendering is now handled by the unified settings panel (see below)

// 初始化时获取当前音色 + sync per-avatar TTS
async function initVoice() {
  try {
    // Switch to current avatar's TTS config
    const avatarCfg = await window.electronAPI.tts.switchAvatar(currentCharacter.id);
    if (avatarCfg.success) {
      currentSelectedVoice = avatarCfg.edgeVoice || currentCharacter.defaultVoice;
      settingsState.currentProvider = avatarCfg.provider || 'edge';
      settingsState.currentMinimaxVoice = avatarCfg.minimaxVoice || '';
    } else {
      const result = await window.electronAPI.tts.getVoice();
      if (result.voiceId) currentSelectedVoice = result.voiceId;
    }
  } catch (e) {
    try {
      const result = await window.electronAPI.tts.getVoice();
      if (result.voiceId) currentSelectedVoice = result.voiceId;
    } catch (_) {}
  }
}

// ===== Avatar Carousel =====
const characterKeys = Object.keys(CHARACTER_PROFILES);
const avatarNameLabel = document.getElementById('avatar-name-label');

function updateAvatarNameLabel() {
  if (avatarNameLabel) avatarNameLabel.textContent = currentCharacter.name;
}

function carouselPrev() {
  const idx = characterKeys.indexOf(currentCharacter.id);
  const prevIdx = (idx - 1 + characterKeys.length) % characterKeys.length;
  const prevChar = CHARACTER_PROFILES[characterKeys[prevIdx]];
  if (prevChar && prevChar.model) {
    switchCharacter(prevChar.id);
  }
}

function carouselNext() {
  const idx = characterKeys.indexOf(currentCharacter.id);
  const nextIdx = (idx + 1) % characterKeys.length;
  const nextChar = CHARACTER_PROFILES[characterKeys[nextIdx]];
  if (nextChar && nextChar.model) {
    switchCharacter(nextChar.id);
  }
}

async function switchCharacter(characterId) {
  const newChar = CHARACTER_PROFILES[characterId];
  if (!newChar || newChar.id === currentCharacter.id) return;

  console.log(`[Character] ${currentCharacter.name} → ${newChar.name}`);

  // 更新角色
  currentCharacter = newChar;
  VIDEO_SOURCES = { ...newChar.videos };

  // 更新光环颜色
  if (auraAnimator && newChar.auraColors) {
    auraAnimator.updateColors(newChar.auraColors);
  }

  // Load new Live2D model
  if (live2dRenderer && newChar.model) {
    await live2dRenderer.loadModel(newChar.model);
  }

  // Switch avatar TTS config (per-avatar routing)
  try {
    const avatarCfg = await window.electronAPI.tts.switchAvatar(characterId);
    if (avatarCfg.success) {
      currentSelectedVoice = avatarCfg.edgeVoice || newChar.defaultVoice;
      settingsState.currentProvider = avatarCfg.provider || 'edge';
      settingsState.currentMinimaxVoice = avatarCfg.minimaxVoice || '';
    }
  } catch (e) {
    // Fallback to character default
    currentSelectedVoice = newChar.defaultVoice;
    try { await window.electronAPI.tts.setVoice(newChar.defaultVoice); } catch (_) {}
  }

  // Update carousel label
  updateAvatarNameLabel();

  // 显示切换提示
  showBubble(`Switched to ${escapeHtml(newChar.name)}`);

  // 重新播放欢迎动画
  isFirstLaunch = true;
  playWelcomeVideo();
}

// ===== 悬浮球模式 =====
const miniOrb = document.getElementById('mini-orb');
const widgetContainer = document.getElementById('widget-container');
const miniOrbAvatar = document.getElementById('mini-orb-avatar');
let isMiniMode = false;
let miniOrbFrameInterval = null;
let miniOrbCropCanvas = null;
let miniOrbCropCtx = null;

function initMiniMode() {
  // 监听主进程的迷你模式切换
  window.electronAPI.onMiniMode((isMini) => {
    if (isMini) {
      enterMiniMode();
    } else {
      exitMiniMode();
    }
  });

  // Drag-to-move + click-to-restore
  let dragStartX, dragStartY, isDragging = false;
  miniOrb.addEventListener('mousedown', (e) => {
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    isDragging = false;

    const onMove = (ev) => {
      const dx = ev.screenX - dragStartX;
      const dy = ev.screenY - dragStartY;
      if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        isDragging = true;
      }
      if (isDragging) {
        window.electronAPI.setWindowPosition &&
          window.electronAPI.setWindowPosition(ev.screenX - 20, ev.screenY - 20);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!isDragging) {
        console.log('[Orb] click → restore');
        window.electronAPI.restoreWindow();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// 悬浮球单击 → 开始/停止聆听
async function onMiniOrbTap() {
  console.log('[Orb] onMiniOrbTap, isMiniMode:', isMiniMode, 'appState:', appState, 'isProcessing:', isProcessing);
  if (!isMiniMode) return;

  // speaking 状态下允许打断 → 直接进入聆听
  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    accumulatedTranscript = '';
    setAppState('listening');
    await startRecording();
    return;
  }

  if (isProcessing) return;

  if (appState === 'listening' || appState === 'followup') {
    clearTimeout(executeTimer);
    const transcript = await stopRecording();
    if (transcript) {
      showBubble('🎤 ' + escapeHtml(transcript), true);
      handleCommand(transcript);
    } else if (accumulatedTranscript.trim()) {
      const cmd = accumulatedTranscript;
      accumulatedTranscript = '';
      handleCommand(cmd);
    } else {
      setMiniOrbState('idle');
      setAppState('idle');
    }
    accumulatedTranscript = '';
    return;
  }

  // 开始聆听
  accumulatedTranscript = '';
  setAppState('listening');
  setMiniOrbState('listening');
  await startRecording();
}

// 更新悬浮球视觉状态
function setMiniOrbState(state) {
  if (!isMiniMode) return;
  miniOrb.classList.remove('mini-listening', 'mini-thinking', 'mini-speaking');
  if (state === 'listening' || state === 'followup') {
    miniOrb.classList.add('mini-listening');
  } else if (state === 'thinking') {
    miniOrb.classList.add('mini-thinking');
  } else if (state === 'speaking') {
    miniOrb.classList.add('mini-speaking');
  }
}

function enterMiniMode() {
  console.log('[Orb] 进入迷你模式');
  isMiniMode = true;
  document.documentElement.classList.add('mini-mode');
  document.body.classList.add('mini-mode');
  // Keep Live2D rendering off-screen at original size
  widgetContainer.style.opacity = '0';
  widgetContainer.style.pointerEvents = 'none';
  widgetContainer.style.position = 'fixed';
  widgetContainer.style.left = '-9999px';
  widgetContainer.style.width = '330px';
  widgetContainer.style.height = '550px';
  miniOrb.style.display = 'flex';
  setMiniOrbState(appState);

  // Continuously capture Live2D canvas frames for animated mini-orb
  const canvas = document.getElementById('live2d-canvas');
  if (canvas) {
    if (!miniOrbCropCanvas) {
      miniOrbCropCanvas = document.createElement('canvas');
      miniOrbCropCanvas.width = 128;
      miniOrbCropCanvas.height = 128;
      miniOrbCropCtx = miniOrbCropCanvas.getContext('2d');
    }
    let pendingBlob = false;
    const captureFrame = () => {
      if (pendingBlob) return;
      try {
        const cropH = canvas.height * 0.4;
        const cropW = Math.min(canvas.width, cropH);
        const sx = (canvas.width - cropW) / 2;
        const sy = canvas.height * 0.05;
        miniOrbCropCtx.clearRect(0, 0, 128, 128);
        miniOrbCropCtx.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, 128, 128);
        pendingBlob = true;
        miniOrbCropCanvas.toBlob((blob) => {
          pendingBlob = false;
          if (blob && isMiniMode) {
            const url = URL.createObjectURL(blob);
            const oldSrc = miniOrbAvatar.src;
            miniOrbAvatar.src = url;
            if (oldSrc && oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
          }
        }, 'image/png');
      } catch (e) {}
    };
    captureFrame();
    miniOrbFrameInterval = setInterval(captureFrame, 16); // 60fps
  }
}

function exitMiniMode() {
  console.log('[Orb] 退出迷你模式，恢复完整窗口');
  isMiniMode = false;
  if (miniOrbFrameInterval) {
    clearInterval(miniOrbFrameInterval);
    miniOrbFrameInterval = null;
  }
  document.documentElement.classList.remove('mini-mode');
  document.body.classList.remove('mini-mode');
  miniOrb.style.display = 'none';
  miniOrb.classList.remove('mini-listening', 'mini-thinking', 'mini-speaking');
  widgetContainer.style.opacity = '';
  widgetContainer.style.pointerEvents = '';
  widgetContainer.style.position = '';
  widgetContainer.style.left = '';
  widgetContainer.style.width = '';
  widgetContainer.style.height = '';

  // 如果在聆听中恢复，保持聆听状态
  if (appState === 'listening' || appState === 'followup') {
    setAppState(appState);
  }
}

// ===== 事件监听 =====
// Avatar tap (quick) = interrupt/focus; hold (300ms+) = push-to-talk
let avatarPressTimer = null;
let avatarIsHolding = false;

lobsterArea.addEventListener('mousedown', (e) => {
  if (e.target.closest('.avatar-nav') || e.target.closest('.tap-hint')) return;
  avatarIsHolding = false;
  avatarPressTimer = setTimeout(() => {
    avatarIsHolding = true;
    if (appState === 'idle' || appState === 'followup') {
      accumulatedTranscript = '';
      setAppState('listening');
      startRecording();
    }
  }, 300);
});

lobsterArea.addEventListener('mouseup', async (e) => {
  if (e.target.closest('.avatar-nav') || e.target.closest('.tap-hint')) return;
  clearTimeout(avatarPressTimer);
  if (avatarIsHolding && isRecording) {
    avatarIsHolding = false;
    const transcript = await stopRecording();
    if (transcript) {
      showBubble('🎤 ' + escapeHtml(transcript), true);
      handleCommand(transcript);
    } else if (!useGroqSTT && accumulatedTranscript.trim()) {
      const cmd = accumulatedTranscript;
      accumulatedTranscript = '';
      handleCommand(cmd);
    } else if (appState === 'listening') {
      setAppState('idle');
    }
  } else if (!avatarIsHolding) {
    onLobsterClick();
  }
  avatarIsHolding = false;
});

lobsterArea.addEventListener('mouseleave', () => {
  clearTimeout(avatarPressTimer);
  if (avatarIsHolding && isRecording) {
    avatarIsHolding = false;
    accumulatedTranscript = '';
    stopRecording();
    setAppState('idle');
  }
});

// Avatar carousel buttons
document.getElementById('avatar-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  carouselPrev();
});
document.getElementById('avatar-next').addEventListener('click', (e) => {
  e.stopPropagation();
  carouselNext();
});

// ===== Hotkey settings =====
const tapKeycap = document.getElementById('tap-keycap');

// Default combo: Option+Space (fn is not detectable via JS)
const DEFAULT_COMBO = { ctrl: false, alt: true, shift: false, meta: false, code: 'Space' };

// e.code → display label (physical key names)
const CODE_LABEL = {
  'fn': 'fn',
  'Backquote': '`', 'Minus': '-', 'Equal': '=',
  'BracketLeft': '[', 'BracketRight': ']', 'Backslash': '\\',
  'Semicolon': ';', 'Quote': "'", 'Comma': ',', 'Period': '.', 'Slash': '/',
  'Space': 'Space', 'Tab': 'Tab', 'Enter': '↵',
  'Backspace': '⌫', 'Escape': 'Esc', 'CapsLock': 'Caps',
  'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
};

// Modifier keys (skip as main key during recording)
const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
]);

let pttCombo = DEFAULT_COMBO;
let isCapturingHotkey = false;

// Load saved combo
try {
  const saved = localStorage.getItem('pttCombo');
  if (saved) pttCombo = JSON.parse(saved);
} catch (e) {}

function codeToLabel(code) {
  if (CODE_LABEL[code]) return CODE_LABEL[code];
  // KeyA → A, KeyZ → Z
  if (code.startsWith('Key')) return code.slice(3);
  // Digit1 → 1
  if (code.startsWith('Digit')) return code.slice(5);
  // F1, F2, etc.
  if (/^F\d+$/.test(code)) return code;
  // Numpad
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

function comboToLabel(combo) {
  const c = combo.code || combo.key || 'fn'; // backward compat
  if (c === 'fn') return 'Fn (hold)';
  const parts = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Opt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Cmd');
  parts.push(codeToLabel(c));
  return parts.join(' + ');
}

function comboToShortLabel(combo) {
  const c = combo.code || combo.key || 'fn';
  if (c === 'fn') return 'Fn';
  const parts = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Opt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Cmd');
  parts.push(codeToLabel(c));
  return parts.join('+');
}

function comboCode(combo) {
  return combo.code || combo.key || 'fn';
}

function updateHotkeyUI() {
  // Update tap hint keycap
  tapKeycap.textContent = comboToShortLabel(pttCombo);

  // Update settings panel hotkey badge if open
  const badge = document.getElementById('settings-hotkey-badge');
  if (badge) badge.textContent = comboToLabel(pttCombo);

  // Update preset active state
  document.querySelectorAll('.settings-preset-btn').forEach(btn => {
    try {
      const preset = JSON.parse(btn.dataset.combo);
      const pCode = preset.code || preset.key || 'fn';
      const curCode = comboCode(pttCombo);
      const match = (!!preset.ctrl === !!pttCombo.ctrl) &&
                    (!!preset.alt === !!pttCombo.alt) &&
                    (!!preset.shift === !!pttCombo.shift) &&
                    (!!preset.meta === !!pttCombo.meta) &&
                    (pCode === curCode);
      btn.classList.toggle('active', match);
    } catch (e) {}
  });
}

function setPttCombo(combo) {
  pttCombo = combo;
  localStorage.setItem('pttCombo', JSON.stringify(combo));
  updateHotkeyUI();
  console.log('[Hotkey] PTT combo set to:', comboToLabel(combo));
  // Sync to main process for global shortcut
  if (window.electronAPI && window.electronAPI.ptt) {
    window.electronAPI.ptt.setShortcut(combo);
  }
}

function stopCapturing() {
  isCapturingHotkey = false;
  const capture = document.getElementById('settings-hotkey-capture');
  const captureText = document.getElementById('settings-capture-text');
  const captureIcon = document.getElementById('settings-capture-icon');
  if (capture) capture.classList.remove('listening');
  if (captureText) captureText.textContent = 'Tap to record new combo';
  if (captureIcon) captureIcon.setAttribute('data-icon', 'mdi:circle-outline');
}

// Global keydown handler for capture and PTT
document.addEventListener('keydown', (e) => {
  const anyPanelOpen = isAnyPanelOpen();

  // --- Capture mode: record key combo ---
  if (isCapturingHotkey && anyPanelOpen) {
    if (MODIFIER_CODES.has(e.code)) return;

    e.preventDefault();
    e.stopPropagation();

    const combo = {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
      code: e.code,
    };

    setPttCombo(combo);
    stopCapturing();
    const captureText = document.getElementById('settings-capture-text');
    if (captureText) captureText.textContent = `Set: ${comboToLabel(combo)}`;
    return;
  }

  // --- Push-to-talk trigger ---
  if (anyPanelOpen) return;
  if (e.repeat) return;
  if (document.activeElement === textInput) return;

  const cc = comboCode(pttCombo);

  // Fn/Globe key: match via e.key since e.code may vary
  const codeMatch = cc === 'fn' ? (e.key === 'Fn' || e.key === 'fn') : e.code === cc;
  const modMatch = (!!e.ctrlKey === !!pttCombo.ctrl) &&
                   (!!e.altKey === !!pttCombo.alt) &&
                   (!!e.shiftKey === !!pttCombo.shift) &&
                   (!!e.metaKey === !!pttCombo.meta);

  if (codeMatch && modMatch) {
    e.preventDefault();
    if (appState === 'idle' || appState === 'followup') {
      accumulatedTranscript = '';
      setAppState('listening');
      startRecording();
    } else if (appState === 'listening') {
      stopRecording().then((transcript) => {
        if (transcript) {
          showBubble('🎤 ' + escapeHtml(transcript), true);
          handleCommand(transcript);
        } else if (accumulatedTranscript.trim()) {
          const cmd = accumulatedTranscript;
          accumulatedTranscript = '';
          handleCommand(cmd);
        } else {
          setAppState('idle');
        }
      });
    } else if (appState === 'speaking') {
      interruptTTS();
      isProcessing = false;
      setAppState('idle');
    }
  }

  if (e.code === 'Escape' && appState === 'listening') {
    e.preventDefault();
    accumulatedTranscript = '';
    groqAudioChunks = [];
    stopRecording().then(() => {
      setAppState('idle');
      showBubble('Recording cancelled');
    });
  }
});

// Initialize hotkey display
updateHotkeyUI();

// ===== Unified Settings Panel =====
const settingsState = {
  currentProvider: 'edge',
  minimaxVoices: [],
  currentMinimaxVoice: '',
  sttProvider: 'deepgram',
  groqModel: 'whisper-large-v3-turbo',
  previewAudio: null,
};

// Open TTS settings panel (per-avatar voice)
async function openTTSSettingsPanel() {
  const panel = document.getElementById('tts-settings-panel');
  if (!panel) return;

  // Close other panels first
  closeGlobalSettingsPanel();

  // Load avatar's TTS config
  try {
    const avatarCfg = await window.electronAPI.tts.getAvatarConfig(currentCharacter.id);
    if (avatarCfg) {
      settingsState.currentProvider = avatarCfg.ttsProvider || 'edge';
      currentSelectedVoice = avatarCfg.edgeVoice || currentCharacter.defaultVoice;
      settingsState.currentMinimaxVoice = avatarCfg.minimaxVoice || '';
    }
  } catch (e) {}

  // Update avatar tag
  const avatarTag = document.getElementById('settings-avatar-tag');
  if (avatarTag) avatarTag.textContent = currentCharacter.name;

  // Update TTS provider pills
  updateSettingsPills('settings-tts-pills', 'provider', settingsState.currentProvider);

  // Render voice list for current provider
  renderSettingsVoiceList();

  panel.style.display = 'flex';
  onPanelOpen();
}

function closeTTSSettingsPanel() {
  const panel = document.getElementById('tts-settings-panel');
  if (panel) panel.style.display = 'none';
  // Stop any preview audio
  if (settingsState.previewAudio) {
    settingsState.previewAudio.pause();
    settingsState.previewAudio = null;
    previewingVoice = null;
  }
  onPanelClose();
}

// Open Global settings panel
async function openGlobalSettingsPanel() {
  const panel = document.getElementById('global-settings-panel');
  if (!panel) return;

  // Close other panels first
  closeTTSSettingsPanel();

  // Load STT config
  try {
    const stt = await window.electronAPI.stt.getProvider();
    settingsState.sttProvider = stt.provider || 'deepgram';
    settingsState.groqModel = stt.groqModel || 'whisper-large-v3-turbo';
  } catch (e) {}

  // Update STT provider pills
  updateSettingsPills('settings-stt-pills', 'stt', settingsState.sttProvider);
  const groqOpts = document.getElementById('settings-groq-options');
  if (groqOpts) groqOpts.style.display = settingsState.sttProvider === 'groq' ? '' : 'none';
  updateSettingsPills('settings-groq-model-pills', 'model', settingsState.groqModel);

  // Load API key statuses
  loadKeyStatuses();

  // Update hotkey
  updateHotkeyUI();

  panel.style.display = 'flex';
  onPanelOpen();
}

function closeGlobalSettingsPanel() {
  const panel = document.getElementById('global-settings-panel');
  if (panel) panel.style.display = 'none';
  stopCapturing();
  onPanelClose();
}

function updateSettingsPills(containerId, dataAttr, activeValue) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.settings-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset[dataAttr] === activeValue);
  });
}

// Render voice list based on current provider
function renderSettingsVoiceList() {
  const list = document.getElementById('settings-voice-list');
  if (!list) return;
  list.innerHTML = '';

  if (settingsState.currentProvider === 'edge') {
    renderEdgeVoices(list);
  } else if (settingsState.currentProvider === 'minimax') {
    renderMinimaxVoicesInSettings(list);
  }
}

function renderEdgeVoices(container) {
  VOICE_OPTIONS.forEach(group => {
    const label = document.createElement('div');
    label.className = 'settings-voice-group';
    label.textContent = group.group;
    container.appendChild(label);

    group.voices.forEach(voice => {
      const item = document.createElement('div');
      item.className = 'settings-voice-item' + (voice.id === currentSelectedVoice ? ' active' : '');
      item.innerHTML = `
        <span class="voice-icon"><span class="iconify" data-icon="${voice.icon}"></span></span>
        <div class="voice-info">
          <div class="voice-name">${voice.name}</div>
          <div class="voice-desc">${voice.desc}</div>
        </div>
        <button class="voice-preview-btn" title="Preview">
          <span class="iconify" data-icon="mdi:play"></span>
        </button>
        ${voice.id === currentSelectedVoice ? '<span class="voice-check"><span class="iconify" data-icon="mdi:check"></span></span>' : ''}
      `;

      item.addEventListener('click', async (e) => {
        if (e.target.closest('.voice-preview-btn')) return;
        currentSelectedVoice = voice.id;
        await window.electronAPI.tts.setVoice(voice.id);
        await window.electronAPI.tts.setAvatarConfig(currentCharacter.id, { edgeVoice: voice.id });
        renderSettingsVoiceList();
      });

      item.querySelector('.voice-preview-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await previewEdgeVoice(voice.id, e.currentTarget);
      });

      container.appendChild(item);
    });
  });
}

async function previewEdgeVoice(voiceId, btn) {
  if (previewingVoice === voiceId) return;
  previewingVoice = voiceId;
  if (btn) btn.classList.add('playing');

  const previewText = voiceId.startsWith('zh-') ? '你好，很高兴认识你！' : 'Hello! Nice to meet you.';
  try {
    await window.electronAPI.tts.setVoice(voiceId);
    const result = await window.electronAPI.deepgram.textToSpeech(previewText);
    if (result.success) {
      if (settingsState.previewAudio) settingsState.previewAudio.pause();
      const audio = new Audio('data:audio/mp3;base64,' + result.audio);
      settingsState.previewAudio = audio;
      audio.onended = () => { previewingVoice = null; if (btn) btn.classList.remove('playing'); };
      audio.onerror = () => { previewingVoice = null; if (btn) btn.classList.remove('playing'); };
      await audio.play();
    }
    await window.electronAPI.tts.setVoice(currentSelectedVoice);
  } catch (e) {
    previewingVoice = null;
    if (btn) btn.classList.remove('playing');
    await window.electronAPI.tts.setVoice(currentSelectedVoice);
  }
}

function renderMinimaxVoicesInSettings(container) {
  if (settingsState.minimaxVoices.length === 0) {
    container.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.4);padding:8px;">Add your MiniMax API key below to see available voices.</div>';
    // Try loading voices
    loadMinimaxVoicesForSettings();
    return;
  }

  settingsState.minimaxVoices.forEach(voice => {
    const item = document.createElement('div');
    item.className = 'settings-voice-item' + (voice.id === settingsState.currentMinimaxVoice ? ' active' : '');
    item.innerHTML = `
      <span class="voice-icon"><span class="iconify" data-icon="mdi:account-voice"></span></span>
      <div class="voice-info">
        <div class="voice-name">${escapeHtml(voice.name)}</div>
        <div class="voice-desc">${escapeHtml(voice.desc || voice.id)}</div>
      </div>
      <button class="voice-preview-btn" title="Preview">
        <span class="iconify" data-icon="mdi:play"></span>
      </button>
      ${voice.id === settingsState.currentMinimaxVoice ? '<span class="voice-check"><span class="iconify" data-icon="mdi:check"></span></span>' : ''}
    `;

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.voice-preview-btn')) return;
      settingsState.currentMinimaxVoice = voice.id;
      await window.electronAPI.tts.setMinimaxVoice(voice.id);
      await window.electronAPI.tts.setAvatarConfig(currentCharacter.id, { minimaxVoice: voice.id });
      renderSettingsVoiceList();
    });

    item.querySelector('.voice-preview-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await previewMinimaxVoice(voice.id, e.currentTarget);
    });

    container.appendChild(item);
  });
}

async function previewMinimaxVoice(voiceId, btn) {
  if (previewingVoice === voiceId) return;
  previewingVoice = voiceId;
  if (btn) btn.classList.add('playing');

  try {
    const result = await window.electronAPI.tts.previewMinimax(voiceId);
    if (result.success) {
      if (settingsState.previewAudio) settingsState.previewAudio.pause();
      const audio = new Audio('data:audio/mp3;base64,' + result.audio);
      settingsState.previewAudio = audio;
      audio.onended = () => { previewingVoice = null; if (btn) btn.classList.remove('playing'); };
      audio.onerror = () => { previewingVoice = null; if (btn) btn.classList.remove('playing'); };
      await audio.play();
    } else {
      console.warn('[TTS] MiniMax preview failed:', result.error);
      previewingVoice = null;
      if (btn) btn.classList.remove('playing');
    }
  } catch (e) {
    console.error('[TTS] Preview error:', e);
    previewingVoice = null;
    if (btn) btn.classList.remove('playing');
  }
}

async function loadMinimaxVoicesForSettings() {
  try {
    const config = await window.electronAPI.tts.getProviderConfig('minimax');
    if (!config.hasKey) return;
    const result = await window.electronAPI.tts.validateMinimax('__use_stored__');
    if (result.success) {
      settingsState.minimaxVoices = result.voices || [];
      renderSettingsVoiceList();
    }
  } catch (e) {
    console.warn('[TTS] Failed to load MiniMax voices:', e);
  }
}

// Load API key status indicators
async function loadKeyStatuses() {
  // MiniMax
  const mmStatus = document.getElementById('settings-minimax-status');
  const mmInput = document.getElementById('settings-minimax-key');
  try {
    const config = await window.electronAPI.tts.getProviderConfig('minimax');
    if (config.hasKey) {
      if (mmStatus) { mmStatus.textContent = 'Key saved'; mmStatus.className = 'settings-key-status success'; }
      if (mmInput) { mmInput.value = ''; mmInput.placeholder = config.apiKeyMasked; }
    }
  } catch (e) {}

  // Groq
  const groqStatus = document.getElementById('settings-groq-status');
  const groqInput = document.getElementById('settings-groq-key');
  try {
    const stt = await window.electronAPI.stt.getProvider();
    // Check if groq key exists by looking at provider config (we don't have a dedicated getter, but if groq was validated, provider is saved)
    // Just show status based on whether groq is selected
    if (stt.provider === 'groq') {
      if (groqStatus) { groqStatus.textContent = 'Active'; groqStatus.className = 'settings-key-status success'; }
    }
  } catch (e) {}
}

// Wire up settings panel events
document.addEventListener('DOMContentLoaded', () => {
  // TTS settings button (speaker icon)
  const ttsBtn = document.getElementById('tts-settings-btn');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTTSSettingsPanel();
    });
  }

  // Global settings button (gear icon)
  const globalBtn = document.getElementById('global-settings-btn');
  if (globalBtn) {
    globalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGlobalSettingsPanel();
    });
  }

  // TTS panel close & done
  const closeTtsBtn = document.getElementById('close-tts-settings');
  if (closeTtsBtn) closeTtsBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTTSSettingsPanel(); });
  const ttsDoneBtn = document.getElementById('tts-settings-done');
  if (ttsDoneBtn) ttsDoneBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTTSSettingsPanel(); });

  // Global panel close & done
  const closeGlobalBtn = document.getElementById('close-global-settings');
  if (closeGlobalBtn) closeGlobalBtn.addEventListener('click', (e) => { e.stopPropagation(); closeGlobalSettingsPanel(); });
  const globalDoneBtn = document.getElementById('global-settings-done');
  if (globalDoneBtn) globalDoneBtn.addEventListener('click', (e) => { e.stopPropagation(); closeGlobalSettingsPanel(); });

  // TTS provider pills
  const ttsPills = document.getElementById('settings-tts-pills');
  if (ttsPills) {
    ttsPills.addEventListener('click', async (e) => {
      const pill = e.target.closest('.settings-pill');
      if (!pill) return;
      const provider = pill.dataset.provider;
      settingsState.currentProvider = provider;
      updateSettingsPills('settings-tts-pills', 'provider', provider);
      await window.electronAPI.tts.setProvider(provider);
      await window.electronAPI.tts.setAvatarConfig(currentCharacter.id, { ttsProvider: provider });
      renderSettingsVoiceList();
    });
  }

  // STT provider pills
  const sttPills = document.getElementById('settings-stt-pills');
  if (sttPills) {
    sttPills.addEventListener('click', async (e) => {
      const pill = e.target.closest('.settings-pill');
      if (!pill) return;
      const provider = pill.dataset.stt;
      settingsState.sttProvider = provider;
      updateSettingsPills('settings-stt-pills', 'stt', provider);
      await window.electronAPI.stt.setProvider(provider);
      const groqOpts = document.getElementById('settings-groq-options');
      if (groqOpts) groqOpts.style.display = provider === 'groq' ? '' : 'none';
    });
  }

  // Groq model pills
  const groqModelPills = document.getElementById('settings-groq-model-pills');
  if (groqModelPills) {
    groqModelPills.addEventListener('click', async (e) => {
      const pill = e.target.closest('.settings-pill');
      if (!pill) return;
      const model = pill.dataset.model;
      settingsState.groqModel = model;
      updateSettingsPills('settings-groq-model-pills', 'model', model);
      await window.electronAPI.stt.setGroqModel(model);
    });
  }

  // Hotkey capture
  const hotkeyCapture = document.getElementById('settings-hotkey-capture');
  if (hotkeyCapture) {
    hotkeyCapture.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isCapturingHotkey) {
        stopCapturing();
        return;
      }
      isCapturingHotkey = true;
      hotkeyCapture.classList.add('listening');
      const captureText = document.getElementById('settings-capture-text');
      const captureIcon = document.getElementById('settings-capture-icon');
      if (captureText) captureText.textContent = 'Press key combo now...';
      if (captureIcon) captureIcon.setAttribute('data-icon', 'mdi:record-circle');
    });
  }

  // Hotkey presets
  document.querySelectorAll('.settings-preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const raw = JSON.parse(btn.dataset.combo);
        const combo = {
          ctrl: !!raw.ctrl,
          alt: !!raw.alt,
          shift: !!raw.shift,
          meta: !!raw.meta,
          code: raw.code || 'Space',
        };
        setPttCombo(combo);
        stopCapturing();
      } catch (err) {
        console.warn('[Hotkey] Bad preset data:', err);
      }
    });
  });

  // MiniMax key save
  const mmSave = document.getElementById('settings-minimax-save');
  if (mmSave) {
    mmSave.addEventListener('click', async (e) => {
      e.stopPropagation();
      const input = document.getElementById('settings-minimax-key');
      const status = document.getElementById('settings-minimax-status');
      const apiKey = input ? input.value.trim() : '';
      if (!apiKey) {
        if (status) { status.textContent = 'Please enter an API key'; status.className = 'settings-key-status error'; }
        return;
      }
      mmSave.classList.add('validating');
      if (status) { status.textContent = 'Validating...'; status.className = 'settings-key-status'; }
      try {
        const result = await window.electronAPI.tts.validateMinimax(apiKey);
        if (result.success) {
          if (status) { status.textContent = `Valid! ${(result.voices||[]).length} voices available`; status.className = 'settings-key-status success'; }
          if (input) { input.value = ''; input.placeholder = apiKey.substring(0, 7) + '****' + apiKey.substring(apiKey.length - 4); }
          settingsState.minimaxVoices = result.voices || [];
          if (settingsState.currentProvider === 'minimax') renderSettingsVoiceList();
        } else {
          if (status) { status.textContent = result.error || 'Invalid API key'; status.className = 'settings-key-status error'; }
        }
      } catch (err) {
        if (status) { status.textContent = 'Failed: ' + err.message; status.className = 'settings-key-status error'; }
      } finally {
        mmSave.classList.remove('validating');
      }
    });
  }

  // Groq key save
  const groqSave = document.getElementById('settings-groq-save');
  if (groqSave) {
    groqSave.addEventListener('click', async (e) => {
      e.stopPropagation();
      const input = document.getElementById('settings-groq-key');
      const status = document.getElementById('settings-groq-status');
      const apiKey = input ? input.value.trim() : '';
      if (!apiKey) {
        if (status) { status.textContent = 'Please enter an API key'; status.className = 'settings-key-status error'; }
        return;
      }
      groqSave.classList.add('validating');
      if (status) { status.textContent = 'Validating...'; status.className = 'settings-key-status'; }
      try {
        const result = await window.electronAPI.stt.validateGroq(apiKey);
        if (result.success) {
          if (status) { status.textContent = 'Key valid!'; status.className = 'settings-key-status success'; }
          if (input) { input.value = ''; input.placeholder = apiKey.substring(0, 7) + '****' + apiKey.substring(apiKey.length - 4); }
        } else {
          if (status) { status.textContent = result.error || 'Invalid API key'; status.className = 'settings-key-status error'; }
        }
      } catch (err) {
        if (status) { status.textContent = 'Failed: ' + err.message; status.className = 'settings-key-status error'; }
      } finally {
        groqSave.classList.remove('validating');
      }
    });
  }

  // Initialize avatar name label
  updateAvatarNameLabel();
});

minimizeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.electronAPI.minimizeWindow();
});

closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.electronAPI.closeWindow();
});

// Start folded by default
bottomPanel.classList.add('folded');
foldToggle.classList.add('folded');

foldToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  bottomPanel.classList.toggle('folded');
  foldToggle.classList.toggle('folded');
});

// ===== 文本输入处理 =====
async function handleTextInput() {
  const text = textInput.value.trim();
  if (!text || isProcessing) return;

  // 清空输入框
  textInput.value = '';

  // 显示用户输入的文字
  showBubble('💬 ' + escapeHtml(text), true);

  // 直接处理命令（不需要语音识别）
  await handleCommand(text);
}

sendBtn.addEventListener('click', handleTextInput);

textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleTextInput();
  }
});
