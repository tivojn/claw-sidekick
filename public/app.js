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
const BUBBLE_AUTO_HIDE = 12000;
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
  if (newState === 'idle') {
    tapHint.classList.remove('hidden');
  } else {
    tapHint.classList.add('hidden');
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
      tapHint.classList.add('hidden');
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

// 追加"查看全文"按钮到气泡底部
function appendViewTextBtn(fullText, label) {
  if (!fullText || fullText.length < 20) return; // 短文本不需要按钮

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

  // TTS 播放完毕，回到 idle（text-only mode, no voice followup）
  if (appState === 'speaking') {
    isProcessing = false;
    setAppState('idle');
    textInput.focus();
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

// ===== 录音控制 =====
async function startRecording() {
  if (isRecording || isProcessing) return;

  try {
    interruptTTS();

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    });

    const result = await window.electronAPI.deepgram.startListening();
    if (!result.success) {
      showBubble('Speech recognition failed to start');
      setAppState('idle');
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
      return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });

    await audioContext.audioWorklet.addModule('audio-processor.js');
    const source = audioContext.createMediaStreamSource(audioStream);
    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

    audioWorkletNode.port.onmessage = (event) => {
      if (isRecording && event.data) {
        const uint8 = new Uint8Array(event.data);
        window.electronAPI.deepgram.sendAudio(uint8);
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

async function stopRecording() {
  if (!isRecording) return;

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

  await window.electronAPI.deepgram.stopListening();
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
  isSpeaking = true;  // 标记正在播放

  try {
    const result = await window.electronAPI.executeCommand(command);

    // 清理 markdown 符号
    const cleanedMessage = cleanMarkdown(result.message);

    // 缓存 AI 回复（用于打断后查看）
    lastAIResponse = cleanedMessage;

    // 流式 TTS 已经在后台播放（由 initStreamingTTS 监听事件驱动）
    // 如果没有收到音频块（例如 Clawdbot 返回空），使用传统 TTS 作为备选
    if (audioQueue.length === 0 && !isPlayingQueue) {
      // 没有收到流式音频，使用传统 TTS
      setAppState('speaking');
      showBubbleWithViewBtn(cleanedMessage);
      await playTextToSpeech(cleanedMessage);

      // TTS 播放完后，再显示文字
      showBubbleWithTyping(escapeHtml(cleanedMessage));

      // 如果是告别语，播放告别动画
      if (isGoodbye) {
        setAppState('goodbye');
        isProcessing = false;
        setTimeout(() => {
          setAppState('idle');
        }, 3000);
      } else {
        // 回到 idle（text-only mode）
        isProcessing = false;
        setAppState('idle');
        textInput.focus();
      }
    }
    // 如果是告别语，特殊处理
    if (isGoodbye) {
      setAppState('goodbye');
      isProcessing = false;
      setTimeout(() => {
        setAppState('idle');
      }, 3000);
    }
    // 否则流式 TTS 会在 processAudioQueue 中自动进入 followup 模式

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
const voicePanel = document.getElementById('voice-panel');
const voiceList = document.getElementById('voice-list');
const voiceSelectBtn = document.getElementById('voice-select-btn');
const closeVoicePanel = document.getElementById('close-voice-panel');

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
let currentFilter = 'all'; // all | zh | en
let previewingVoice = null;

function renderVoiceList() {
  voiceList.innerHTML = '';

  VOICE_OPTIONS.forEach(group => {
    // 筛选：all 显示全部，zh 显示中文和推荐，en 显示英文和推荐
    if (currentFilter !== 'all' && group.lang !== 'all' && group.lang !== currentFilter) {
      return;
    }

    const groupLabel = document.createElement('div');
    groupLabel.className = 'voice-group-label';
    groupLabel.textContent = group.group;
    voiceList.appendChild(groupLabel);

    group.voices.forEach(voice => {
      const item = document.createElement('div');
      item.className = 'voice-item' + (voice.id === currentSelectedVoice ? ' active' : '');
      item.innerHTML = `
        <span class="voice-icon"><span class="iconify" data-icon="${voice.icon}"></span></span>
        <div class="voice-info">
          <div class="voice-name">${voice.name}</div>
          <div class="voice-desc">${voice.desc}</div>
        </div>
        <button class="voice-preview-btn" data-voice="${voice.id}" title="Preview">
          <span class="iconify" data-icon="mdi:play"></span>
        </button>
        ${voice.id === currentSelectedVoice ? '<span class="voice-check"><span class="iconify" data-icon="mdi:check"></span></span>' : ''}
      `;

      // 点击选择音色
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.voice-preview-btn')) {
          selectVoice(voice.id);
        }
      });

      // 试听按钮
      const previewBtn = item.querySelector('.voice-preview-btn');
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        previewVoice(voice.id, voice.name);
      });

      voiceList.appendChild(item);
    });
  });
}

function setFilter(filter) {
  currentFilter = filter;
  // 更新筛选按钮状态
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderVoiceList();
}

async function previewVoice(voiceId, voiceName) {
  if (previewingVoice === voiceId) return;

  previewingVoice = voiceId;
  const previewText = voiceId.startsWith('zh-') ? '你好，很高兴认识你！' : 'Hello! Nice to meet you.';

  try {
    // 临时设置音色
    await window.electronAPI.tts.setVoice(voiceId);
    const result = await window.electronAPI.deepgram.textToSpeech(previewText);

    if (result.success) {
      const audio = new Audio('data:audio/mp3;base64,' + result.audio);
      audio.onended = () => { previewingVoice = null; };
      audio.onerror = () => { previewingVoice = null; };
      await audio.play();
    }

    // 恢复原音色
    await window.electronAPI.tts.setVoice(currentSelectedVoice);
  } catch (e) {
    console.error('[App] 试听失败:', e);
    previewingVoice = null;
    await window.electronAPI.tts.setVoice(currentSelectedVoice);
  }
}

async function selectVoice(voiceId) {
  currentSelectedVoice = voiceId;
  await window.electronAPI.tts.setVoice(voiceId);
  renderVoiceList();
  // 找到音色名字显示提示
  let voiceName = voiceId;
  for (const g of VOICE_OPTIONS) {
    const v = g.voices.find(v => v.id === voiceId);
    if (v) { voiceName = v.name; break; }
  }
  showBubble(`Voice switched to ${escapeHtml(voiceName)}`);
  setTimeout(() => {
    voicePanel.style.display = 'none';
  }, 600);
}

function openVoicePanel() {
  currentFilter = 'all';
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
  });
  renderVoiceList();
  voicePanel.style.display = 'flex';

  // 绑定筛选按钮事件
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => setFilter(btn.dataset.filter);
  });
}

// 初始化时获取当前音色
async function initVoice() {
  try {
    const result = await window.electronAPI.tts.getVoice();
    if (result.voiceId) currentSelectedVoice = result.voiceId;
  } catch (e) {}
}

// ===== 角色切换 =====
const characterPanel = document.getElementById('character-panel');
const characterList = document.getElementById('character-list');
const characterSelectBtn = document.getElementById('character-select-btn');
const closeCharacterPanel = document.getElementById('close-character-panel');

function renderCharacterList() {
  characterList.innerHTML = '';

  Object.values(CHARACTER_PROFILES).forEach(char => {
    const item = document.createElement('div');
    item.className = 'character-item' + (char.id === currentCharacter.id ? ' active' : '');

    const isAvailable = !!char.model; // Available if has a Live2D model

    item.innerHTML = `
      <span class="character-icon"><span class="iconify" data-icon="${char.icon}"></span></span>
      <div class="character-info">
        <div class="character-name">${char.name}${!isAvailable ? ' <span class="coming-soon">No model</span>' : ''}</div>
        <div class="character-desc">${char.desc}</div>
      </div>
      ${char.id === currentCharacter.id ? '<span class="character-check"><span class="iconify" data-icon="mdi:check"></span></span>' : ''}
    `;

    if (isAvailable) {
      item.addEventListener('click', () => {
        switchCharacter(char.id);
      });
    } else {
      item.classList.add('disabled');
    }

    characterList.appendChild(item);
  });
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

  // 切换默认音色
  currentSelectedVoice = newChar.defaultVoice;
  try {
    await window.electronAPI.tts.setVoice(newChar.defaultVoice);
  } catch (e) {}

  // 关闭面板
  characterPanel.style.display = 'none';

  // 显示切换提示
  showBubble(`Switched to ${escapeHtml(newChar.name)}`);

  // 重新播放欢迎动画
  isFirstLaunch = true;
  playWelcomeVideo();

  // 刷新角色列表和音色列表
  renderCharacterList();
  renderVoiceList();
}

function openCharacterPanel() {
  renderCharacterList();
  characterPanel.style.display = 'flex';
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
    // 正在聆听 → 停止
    clearTimeout(executeTimer);
    accumulatedTranscript = '';
    await stopRecording();
    setMiniOrbState('idle');
    setAppState('idle');
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
lobsterArea.addEventListener('click', onLobsterClick);

voiceSelectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openVoicePanel();
});

characterSelectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openCharacterPanel();
});

closeCharacterPanel.addEventListener('click', (e) => {
  e.stopPropagation();
  characterPanel.style.display = 'none';
});

closeVoicePanel.addEventListener('click', (e) => {
  e.stopPropagation();
  voicePanel.style.display = 'none';
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
