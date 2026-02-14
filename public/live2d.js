// ===== Live2D Renderer Module =====
// Encapsulates all Live2D rendering via PixiJS + pixi-live2d-display

class Live2DRenderer {
  constructor(containerElement) {
    this.container = containerElement;
    this.app = null;
    this.model = null;
    this.currentState = 'idle';
    this.modelPath = null;
    this.isLoaded = false;
    this.lipSyncInterval = null;
    this.lipSyncAnalyser = null;
    this.lipSyncAudioCtx = null;
    this.originalModelW = 0;
    this.originalModelH = 0;
    this.motionGroups = {}; // Available motion groups for current model
    this.expressions = [];  // Available expression names for current model

    this._init();
  }

  _init() {
    const canvas = document.getElementById('live2d-canvas');

    // Create PixiJS application (v6 API)
    this.app = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      resizeTo: this.container,
      antialias: true,
      preserveDrawingBuffer: true,
    });

    // Handle resize
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    console.log('[Live2D] Renderer initialized');
  }

  async loadModel(modelPath) {
    // Skip reload if same model is already loaded
    if (this.isLoaded && this.modelPath === modelPath) {
      console.log('[Live2D] Model already loaded, skipping reload');
      return true;
    }

    if (this.model) {
      this.app.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
      this.isLoaded = false;
    }

    this.modelPath = modelPath;
    console.log(`[Live2D] Loading model: ${modelPath}`);

    try {
      // Use PIXI.live2d from pixi-live2d-display (try multiple export paths)
      const Live2DModel = PIXI.live2d?.Live2DModel
        || PIXI.live2d?.Live2DModel4
        || window.Live2DModel;

      if (!Live2DModel) {
        throw new Error('Live2DModel class not found in PIXI.live2d namespace');
      }

      this.model = await Live2DModel.from(modelPath, {
        autoInteract: false,
        autoUpdate: true,
      });

      // Cache original model dimensions before any scaling
      this.originalModelW = this.model.width;
      this.originalModelH = this.model.height;

      // Detect available motion groups and expressions from model definitions
      this._detectCapabilities();

      // Add to stage
      this.app.stage.addChild(this.model);
      this.isLoaded = true;

      // Fit model (try now, then retry after layout settles)
      this._fitModel();
      setTimeout(() => this._fitModel(), 200);

      // Start idle motion
      this._playMotion('Idle', 0);

      console.log('[Live2D] Model loaded successfully');
      return true;
    } catch (error) {
      console.error('[Live2D] Failed to load model:', error);
      this.isLoaded = false;
      return false;
    }
  }

  _fitModel() {
    if (!this.model || !this.originalModelW || !this.originalModelH) return;

    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    if (containerW === 0 || containerH === 0) return;

    // Use cached original dimensions (not current scaled ones)
    const modelW = this.originalModelW;
    const modelH = this.originalModelH;

    // Fit full body inside the container
    const scaleX = containerW / modelW;
    const scaleY = containerH / modelH;
    const scale = Math.min(scaleX, scaleY) * 0.95;

    this.model.scale.set(scale);
    this.model.anchor.set(0.5, 0.5);
    this.model.x = containerW / 2;
    this.model.y = containerH / 2;

    console.log(`[Live2D] Fit: container=${containerW}x${containerH}, origModel=${modelW}x${modelH}, scale=${scale.toFixed(3)}`);
  }

  _detectCapabilities() {
    this.motionGroups = {};
    this.expressions = [];

    try {
      const defs = this.model.internalModel.settings;
      // Extract motion groups from model definitions
      const motions = defs.motions || {};
      for (const group of Object.keys(motions)) {
        this.motionGroups[group] = motions[group].length;
      }
      // Extract expression names
      if (defs.expressions) {
        this.expressions = defs.expressions.map(e => e.Name || e.name || '');
      }
    } catch (e) {
      console.warn('[Live2D] Could not detect model capabilities:', e.message);
    }

    console.log('[Live2D] Motion groups:', this.motionGroups);
    console.log('[Live2D] Expressions:', this.expressions);
  }

  // Get the tap/action motion group name (varies between models)
  _getTapGroup() {
    if (this.motionGroups['TapBody']) return 'TapBody';
    if (this.motionGroups['Tap']) return 'Tap';
    return 'Idle'; // fallback
  }

  // Pick the best available expression for a given intent
  _pickExpression(intent) {
    const has = (name) => this.expressions.includes(name);

    switch (intent) {
      case 'happy':
        if (has('Smile')) return 'Smile';
        if (has('f05')) return 'f05';
        if (has('exp_05')) return 'exp_05';
        return null;
      case 'attentive':
        if (has('Normal')) return 'Normal';
        if (has('f01')) return 'f01';
        if (has('exp_01')) return 'exp_01';
        return null;
      case 'thinking':
        if (has('Normal')) return 'Normal';
        if (has('f03')) return 'f03';
        if (has('exp_03')) return 'exp_03';
        return null;
      case 'sad':
        if (has('Sad')) return 'Sad';
        if (has('f06')) return 'f06';
        if (has('exp_06')) return 'exp_06';
        return null;
      case 'surprised':
        if (has('Surprised')) return 'Surprised';
        if (has('f04')) return 'f04';
        if (has('exp_04')) return 'exp_04';
        return null;
      case 'neutral':
        if (has('Normal')) return 'Normal';
        if (has('f00')) return 'f00';
        if (has('exp_01')) return 'exp_01';
        return null;
      default:
        return null;
    }
  }

  setState(state) {
    if (!this.isLoaded || !this.model) return;
    if (this.currentState === state) return;

    const prevState = this.currentState;
    this.currentState = state;

    console.log(`[Live2D] State: ${prevState} -> ${state}`);

    const tap = this._getTapGroup();
    const idleCount = this.motionGroups['Idle'] || 1;

    switch (state) {
      case 'welcome':
        this._playMotion(tap, 0);
        this._setExpressionByIntent('happy');
        break;

      case 'idle':
        this._playMotion('Idle', 0);
        this._setExpressionByIntent('neutral');
        this.stopSpeaking();
        break;

      case 'listening':
        this._playMotion(tap, Math.min(1, (this.motionGroups[tap] || 1) - 1));
        this._setExpressionByIntent('attentive');
        break;

      case 'thinking':
        this._playMotion('Idle', Math.min(1, idleCount - 1));
        this._setExpressionByIntent('thinking');
        break;

      case 'speaking':
        this._playMotion('Idle', 0);
        this._setExpressionByIntent('happy');
        break;

      case 'followup':
        this._playMotion('Idle', Math.min(2, idleCount - 1));
        this._setExpressionByIntent('attentive');
        break;

      case 'goodbye':
        this._playMotion(tap, 0);
        this._setExpressionByIntent('sad');
        break;
    }
  }

  // Start lip sync driven by an Audio element
  speakWithAudio(audioElement) {
    if (!this.isLoaded || !this.model) return;

    this.stopSpeaking();

    try {
      // Create audio context for analysis
      if (!this.lipSyncAudioCtx || this.lipSyncAudioCtx.state === 'closed') {
        this.lipSyncAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }

      const source = this.lipSyncAudioCtx.createMediaElementSource(audioElement);
      this.lipSyncAnalyser = this.lipSyncAudioCtx.createAnalyser();
      this.lipSyncAnalyser.fftSize = 256;
      this.lipSyncAnalyser.smoothingTimeConstant = 0.6;

      source.connect(this.lipSyncAnalyser);
      this.lipSyncAnalyser.connect(this.lipSyncAudioCtx.destination);

      const dataArray = new Uint8Array(this.lipSyncAnalyser.frequencyBinCount);

      // Update lip sync at 30fps
      this.lipSyncInterval = setInterval(() => {
        if (!this.lipSyncAnalyser || !this.model) {
          this.stopSpeaking();
          return;
        }

        this.lipSyncAnalyser.getByteFrequencyData(dataArray);

        // Calculate volume from frequency data (focus on voice range ~85-255 Hz)
        let sum = 0;
        const voiceStart = 2; // ~85 Hz at 16000 sample rate
        const voiceEnd = 16;  // ~500 Hz
        for (let i = voiceStart; i < voiceEnd && i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / (voiceEnd - voiceStart);
        const volume = Math.min(1, avg / 128);

        // Drive mouth parameter
        this._setMouthOpenY(volume);
      }, 33);

    } catch (error) {
      console.warn('[Live2D] Lip sync setup failed, using simulated lip sync:', error);
      // Fall back to simulated lip sync
      this._startSimulatedLipSync();
    }
  }

  // Simulated lip sync (when audio analysis isn't possible)
  _startSimulatedLipSync() {
    this.stopSpeaking();
    let time = 0;
    this.lipSyncInterval = setInterval(() => {
      time += 0.1;
      // Generate natural-looking mouth movement
      const value = Math.abs(Math.sin(time * 3.5)) *
                    (0.5 + Math.random() * 0.5) *
                    (0.3 + 0.7 * Math.abs(Math.sin(time * 1.2)));
      this._setMouthOpenY(value);
    }, 50);
  }

  stopSpeaking() {
    if (this.lipSyncInterval) {
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
    }

    // Close mouth
    this._setMouthOpenY(0);

    // Disconnect analyser
    if (this.lipSyncAnalyser) {
      try { this.lipSyncAnalyser.disconnect(); } catch (e) {}
      this.lipSyncAnalyser = null;
    }
  }

  // Set mouth open parameter directly (0-1)
  _setMouthOpenY(value) {
    if (!this.model || !this.model.internalModel) return;

    try {
      const coreModel = this.model.internalModel.coreModel;
      // Access parameter values array directly (reliable across Cubism SDK versions)
      const ids = coreModel._model.parameters.ids;
      const paramIndex = ids.indexOf('ParamMouthOpenY');
      if (paramIndex >= 0) {
        coreModel._model.parameters.values[paramIndex] = value;
      }
    } catch (e) {
      // Silently fail - parameter might not exist on some models
    }
  }

  _playMotion(group, index) {
    if (!this.model) return;

    try {
      // Priority: 2 = normal, 3 = force
      this.model.motion(group, index, 2);
    } catch (e) {
      console.warn(`[Live2D] Motion '${group}[${index}]' not available:`, e.message);
      // Try idle as fallback
      if (group !== 'Idle') {
        try { this.model.motion('Idle', 0, 1); } catch (_) {}
      }
    }
  }

  _setExpression(name) {
    if (!this.model || !name) return;

    try {
      this.model.expression(name);
    } catch (e) {
      console.warn(`[Live2D] Expression '${name}' not available`);
    }
  }

  _setExpressionByIntent(intent) {
    const expr = this._pickExpression(intent);
    if (expr) {
      this._setExpression(expr);
    }
  }

  _clearExpression() {
    const neutral = this._pickExpression('neutral');
    if (neutral) {
      this._setExpression(neutral);
    }
  }

  _onResize() {
    if (this.app) {
      this.app.renderer.resize(this.container.clientWidth, this.container.clientHeight);
    }
    this._fitModel();
  }

  resize() {
    this._onResize();
  }

  destroy() {
    this.stopSpeaking();

    if (this.lipSyncAudioCtx && this.lipSyncAudioCtx.state !== 'closed') {
      this.lipSyncAudioCtx.close().catch(() => {});
    }

    window.removeEventListener('resize', this._onResize);

    if (this.model) {
      this.app.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }

    if (this.app) {
      this.app.destroy(false); // Don't remove the canvas
      this.app = null;
    }

    this.isLoaded = false;
    console.log('[Live2D] Renderer destroyed');
  }
}

// Export
window.Live2DRenderer = Live2DRenderer;
