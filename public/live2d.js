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
    this._lipSyncValue = 0;         // Current lip sync mouth open value (0-1)
    this._lipSyncActive = false;    // Whether lip sync ticker is running
    this._lipSyncTicker = null;     // Bound ticker function
    this.originalModelW = 0;
    this.originalModelH = 0;
    this.motionGroups = {}; // Available motion groups for current model
    this.expressions = [];  // Available expression names for current model
    this.hitAreas = [];     // Available hit areas for current model

    // ===== Interactive feature state =====
    this._breathInterval = null;
    this._idleVarietyInterval = null;
    this._idleTimeoutHandle = null;
    this._lastInteractionTime = Date.now();
    this._isIdleTimeout = false;      // True when model has gone "sleepy"
    this._cursorProximity = 1.0;      // 0 = very close, 1 = far away
    this._headPatCount = 0;           // Consecutive head pats
    this._headPatResetTimer = null;

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

    // Cleanup previous model's interactive features
    this._stopInteractiveFeatures();

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
        autoInteract: true,
        autoUpdate: true,
      });

      // Cache original model dimensions before any scaling
      this.originalModelW = this.model.width;
      this.originalModelH = this.model.height;

      // Detect available motion groups, expressions, and hit areas
      this._detectCapabilities();

      // Add to stage
      this.app.stage.addChild(this.model);
      this.isLoaded = true;

      // Fit model (try now, then retry after layout settles)
      this._fitModel();
      setTimeout(() => this._fitModel(), 200);

      // Enable mouse/pointer interaction
      this._setupInteraction();

      // Start interactive features
      this._startBreathing();
      this._startIdleVariety();
      this._startIdleTimeout();

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
    this.hitAreas = [];

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
      // Extract hit areas
      if (defs.hitAreas) {
        this.hitAreas = defs.hitAreas.map(h => h.Name || h.name || '');
      }
    } catch (e) {
      console.warn('[Live2D] Could not detect model capabilities:', e.message);
    }

    console.log('[Live2D] Motion groups:', this.motionGroups);
    console.log('[Live2D] Expressions:', this.expressions);
    console.log('[Live2D] Hit areas:', this.hitAreas);
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

    // Expression maps per model:
    // Haru:   f00=slight mouth, f01=excited(open eyes), f02=angry, f03=sad, f04=happy(closed eyes),
    //         f05=shocked(wide eyes), f06=blushing, f07=calm/serious
    // Natori: Normal, Angry, Sad, Smile(closed eyes), Surprised, Blushing, exp_01=mischievous,
    //         exp_02=grinning(teeth), exp_03=pouty, exp_04=worried, exp_05=crying
    // Hiyori: NO expressions (returns null, uses direct param control)
    // Mao:    exp_01=normal, exp_02=blissful(closed eyes), exp_03=sleepy(closed eyes),
    //         exp_04=sparkle(wide open), exp_05=sad, exp_06=blushing, exp_07=worried, exp_08=angry
    switch (intent) {
      case 'happy':
        // Eyes OPEN and happy
        if (has('Smile')) return 'Smile';        // Natori: smile (Note: eyes closed)
        if (has('f01')) return 'f01';            // Haru: excited, eyes open
        if (has('exp_04')) return 'exp_04';      // Mao: sparkle eyes, wide open
        return null;
      case 'blissful':
        // Eyes closed content smile (^_^) — only for head pat moments
        if (has('f04')) return 'f04';            // Haru: happy closed eyes
        if (has('Smile')) return 'Smile';        // Natori: smile closed eyes
        if (has('exp_02')) return 'exp_02';      // Mao: blissful closed eyes
        return null;
      case 'excited':
        if (has('exp_04')) return 'exp_04';      // Mao: sparkle eyes
        if (has('f01')) return 'f01';            // Haru: excited
        if (has('Surprised')) return 'Surprised'; // Natori: surprised
        return this._pickExpression('happy');
      case 'attentive':
        if (has('Normal')) return 'Normal';       // Natori
        if (has('f00')) return 'f00';            // Haru: slight mouth (attentive)
        if (has('exp_01')) return 'exp_01';      // Mao: normal eyes open
        return null;
      case 'thinking':
        // Eyes open, thoughtful look
        if (has('Normal')) return 'Normal';       // Natori
        if (has('f07')) return 'f07';            // Haru: calm/serious (eyes slightly closed but open)
        if (has('exp_01')) return 'exp_01';      // Mao: normal eyes open
        return null;
      case 'sad':
        if (has('Sad')) return 'Sad';            // Natori
        if (has('f03')) return 'f03';            // Haru: sad/worried
        if (has('exp_05')) return 'exp_05';      // Mao: sad
        return null;
      case 'surprised':
        if (has('Surprised')) return 'Surprised'; // Natori
        if (has('f05')) return 'f05';            // Haru: shocked (eyes wide)
        if (has('exp_07')) return 'exp_07';      // Mao: worried/surprised (wide eyes)
        return null;
      case 'shy':
        if (has('Blushing')) return 'Blushing';  // Natori: blushing
        if (has('f06')) return 'f06';            // Haru: blushing
        if (has('exp_06')) return 'exp_06';      // Mao: blushing shy
        return this._pickExpression('happy');
      case 'worried':
        if (has('exp_04')) return 'exp_04';      // Natori: worried/concerned
        if (has('f03')) return 'f03';            // Haru: sad/worried
        if (has('exp_07')) return 'exp_07';      // Mao: worried face
        return this._pickExpression('sad');
      case 'angry':
        if (has('Angry')) return 'Angry';        // Natori
        if (has('f02')) return 'f02';            // Haru: angry/upset
        if (has('exp_08')) return 'exp_08';      // Mao: angry/pouty
        return null;
      case 'sleepy':
        if (has('exp_03')) return 'exp_03';      // Mao: closed eyes calm
        if (has('f04')) return 'f04';            // Haru: happy closed eyes (closest to sleepy)
        if (has('Smile')) return 'Smile';        // Natori: closed eyes
        return null;
      case 'neutral':
        if (has('Normal')) return 'Normal';       // Natori
        if (has('f00')) return 'f00';            // Haru
        if (has('exp_01')) return 'exp_01';      // Mao
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

    // Any state change wakes from idle timeout
    if (this._isIdleTimeout && state !== 'idle') {
      this._wakeFromIdleTimeout();
    }

    console.log(`[Live2D] State: ${prevState} -> ${state}`);

    const tap = this._getTapGroup();
    const idleCount = this.motionGroups['Idle'] || 1;

    switch (state) {
      case 'welcome':
        this._playMotion(tap, 0);
        this._setExpressionByIntent('excited');
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

      // Start the lip sync ticker to apply values every frame
      this._startLipSyncTicker();

      // Update lip sync value at 30fps (ticker applies it every frame)
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

        // Set lip sync value (applied by ticker every frame)
        this._lipSyncValue = volume;
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
    this._startLipSyncTicker();
    let time = 0;
    this.lipSyncInterval = setInterval(() => {
      time += 0.1;
      // Generate natural-looking mouth movement with more amplitude
      const value = Math.abs(Math.sin(time * 3.5)) *
                    (0.6 + Math.random() * 0.4) *
                    (0.4 + 0.6 * Math.abs(Math.sin(time * 1.2)));
      this._lipSyncValue = Math.max(0.1, value); // Minimum 0.1 so mouth is always slightly open
    }, 50);
  }

  stopSpeaking() {
    if (this.lipSyncInterval) {
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
    }

    // Stop the frame ticker
    this._stopLipSyncTicker();

    // Disconnect analyser
    if (this.lipSyncAnalyser) {
      try { this.lipSyncAnalyser.disconnect(); } catch (e) {}
      this.lipSyncAnalyser = null;
    }
  }

  // ===== Parameter Control =====

  // Set a model parameter directly by ID (0-1 range for most params)
  _setParam(paramId, value) {
    if (!this.model || !this.model.internalModel) return;
    try {
      const coreModel = this.model.internalModel.coreModel;
      const ids = coreModel._model.parameters.ids;
      const idx = ids.indexOf(paramId);
      if (idx >= 0) {
        coreModel._model.parameters.values[idx] = value;
      }
    } catch (e) {
      // Parameter might not exist on this model
    }
  }

  // Get a model parameter value by ID
  _getParam(paramId) {
    if (!this.model || !this.model.internalModel) return 0;
    try {
      const coreModel = this.model.internalModel.coreModel;
      const ids = coreModel._model.parameters.ids;
      const idx = ids.indexOf(paramId);
      if (idx >= 0) {
        return coreModel._model.parameters.values[idx];
      }
    } catch (e) {}
    return 0;
  }

  // Set mouth open value (applied every frame via ticker to beat motion overrides)
  _setMouthOpenY(value) {
    this._lipSyncValue = value;
  }

  // Start the lip sync ticker (runs every frame AFTER motion updates)
  _startLipSyncTicker() {
    if (this._lipSyncActive) return;
    this._lipSyncActive = true;

    if (!this._lipSyncTicker) {
      this._lipSyncTicker = () => {
        if (!this.model || !this.model.internalModel) return;
        if (this._lipSyncValue <= 0) return;
        try {
          const coreModel = this.model.internalModel.coreModel;
          const ids = coreModel._model.parameters.ids;
          // Apply to ParamA (Mao lip sync) and ParamMouthOpenY (standard)
          const idxA = ids.indexOf('ParamA');
          if (idxA >= 0) coreModel._model.parameters.values[idxA] = this._lipSyncValue;
          const idxM = ids.indexOf('ParamMouthOpenY');
          if (idxM >= 0) coreModel._model.parameters.values[idxM] = this._lipSyncValue;
        } catch (e) {}
      };
    }

    // Add as PIXI ticker — runs every frame after model update
    if (this.app && this.app.ticker) {
      this.app.ticker.add(this._lipSyncTicker);
    }
    console.log('[Live2D] Lip sync ticker started');
  }

  _stopLipSyncTicker() {
    if (!this._lipSyncActive) return;
    this._lipSyncActive = false;
    this._lipSyncValue = 0;

    if (this.app && this.app.ticker && this._lipSyncTicker) {
      this.app.ticker.remove(this._lipSyncTicker);
    }
    // Force close mouth one last time
    this._setParam('ParamA', 0);
    this._setParam('ParamMouthOpenY', 0);
    console.log('[Live2D] Lip sync ticker stopped');
  }

  // ===== Feature 1: Hit Area Detection =====

  _handleTap(e) {
    if (!this.model || !this.isLoaded) return;
    if (this.currentState === 'speaking') return;

    // Record interaction
    this._onUserInteraction();

    // Get tap coordinates — try multiple approaches for hit testing
    let hitAreas = [];
    try {
      // pixi-live2d-display hitTest expects coordinates relative to the model
      // e.data.global gives PIXI renderer coordinates
      const gx = e.data.global.x;
      const gy = e.data.global.y;
      hitAreas = this.model.hitTest(gx, gy);
    } catch (err) {
      console.warn('[Live2D] hitTest error:', err.message);
    }

    console.log('[Live2D] Hit areas:', hitAreas);

    // If hitTest didn't return areas, use vertical position heuristic
    if (hitAreas.length === 0 && this.hitAreas.length > 0) {
      try {
        const gy = e.data.global.y;
        const modelCenterY = this.model.y;
        const modelH = this.originalModelH * this.model.scale.y;
        // Top 35% = head, bottom 65% = body
        const relY = (gy - (modelCenterY - modelH / 2)) / modelH;
        if (relY < 0.35) {
          hitAreas = ['Head'];
        } else {
          hitAreas = ['Body'];
        }
        console.log(`[Live2D] Heuristic hit: relY=${relY.toFixed(2)} → ${hitAreas[0]}`);
      } catch (err) {}
    }

    if (hitAreas.includes('Head')) {
      this._onHeadTap();
    } else if (hitAreas.includes('Body')) {
      this._onBodyTap();
    } else {
      this._onGenericTap();
    }
  }

  _onHeadTap() {
    this._headPatCount++;
    console.log(`[Live2D] Head pat #${this._headPatCount}`);

    // Reset head pat counter after 3 seconds of no pats
    clearTimeout(this._headPatResetTimer);
    this._headPatResetTimer = setTimeout(() => {
      this._headPatCount = 0;
    }, 3000);

    if (this._headPatCount >= 5) {
      // Many head pats → blissful closed-eyes smile + sparkle + hearts!
      this._setExpressionByIntent('blissful');
      this._playMotion(this._getTapGroup(), 0);
      this._setParam('ParamCheek', 1);
      this._triggerHeartEffect();
      setTimeout(() => {
        this._setParam('ParamCheek', 0);
        if (this.currentState === 'idle' || this.currentState === 'followup') {
          this._setExpressionByIntent('neutral');
        }
      }, 3500);
    } else if (this._headPatCount >= 3) {
      // Several pats → blushing shy with cheek color
      this._setExpressionByIntent('shy');
      this._setParam('ParamCheek', 1);
      const tapGroup = this._getTapGroup();
      const count = this.motionGroups[tapGroup] || 1;
      this._playMotion(tapGroup, Math.floor(Math.random() * count));
      setTimeout(() => {
        this._setParam('ParamCheek', 0);
        if (this.currentState === 'idle' || this.currentState === 'followup') {
          this._setExpressionByIntent('neutral');
        }
      }, 2500);
    } else {
      // First pats → excited sparkle eyes + light blush
      this._setExpressionByIntent('excited');
      this._setParam('ParamCheek', 0.5);
      this._playMotion(this._getTapGroup(), 0);
      setTimeout(() => {
        this._setParam('ParamCheek', 0);
        if (this.currentState === 'idle' || this.currentState === 'followup') {
          this._setExpressionByIntent('neutral');
        }
      }, 2000);
    }
  }

  _onBodyTap() {
    console.log('[Live2D] Body tap');
    // Random TapBody motion + surprised then recover
    const tap = this._getTapGroup();
    const count = this.motionGroups[tap] || 1;
    const idx = Math.floor(Math.random() * count);
    this._playMotion(tap, idx);

    // Random reaction: surprised, angry, or worried
    const reactions = ['surprised', 'angry', 'worried'];
    const reaction = reactions[Math.floor(Math.random() * reactions.length)];
    this._setExpressionByIntent(reaction);

    setTimeout(() => {
      if (this.currentState === 'idle' || this.currentState === 'followup') {
        this._setExpressionByIntent('neutral');
      }
    }, 2000);
  }

  _onGenericTap() {
    console.log('[Live2D] Generic tap');
    const tap = this._getTapGroup();
    const count = this.motionGroups[tap] || 1;
    const idx = Math.floor(Math.random() * count);
    this._playMotion(tap, idx);
    this._setExpressionByIntent('surprised');

    setTimeout(() => {
      if (this.currentState === 'idle' || this.currentState === 'followup') {
        this._setExpressionByIntent('neutral');
      }
    }, 2000);
  }

  // ===== Feature 2: Breathing Animation =====

  _startBreathing() {
    this._stopBreathing();
    let breathTime = 0;
    this._breathInterval = setInterval(() => {
      if (!this.model || !this.isLoaded) return;
      breathTime += 0.05;
      // Natural breathing: slow sine wave (about 15 breaths per minute)
      const breathValue = (Math.sin(breathTime * 1.5) + 1) / 2; // 0 to 1
      this._setParam('ParamBreath', breathValue);
    }, 33); // ~30fps
  }

  _stopBreathing() {
    if (this._breathInterval) {
      clearInterval(this._breathInterval);
      this._breathInterval = null;
    }
  }

  // ===== Feature 3: Idle Variety =====

  _startIdleVariety() {
    this._stopIdleVariety();
    this._idleVarietyInterval = setInterval(() => {
      if (!this.model || !this.isLoaded) return;
      if (this.currentState !== 'idle' && this.currentState !== 'followup') return;
      if (this._isIdleTimeout) return; // Don't change motions while sleeping

      const idleCount = this.motionGroups['Idle'] || 1;
      if (idleCount <= 1) return;

      // Pick a random idle motion
      const idx = Math.floor(Math.random() * idleCount);
      this._playMotion('Idle', idx);

      // Occasionally change expression too
      if (Math.random() < 0.3) {
        const idleExpressions = ['neutral', 'happy', 'attentive'];
        const expr = idleExpressions[Math.floor(Math.random() * idleExpressions.length)];
        this._setExpressionByIntent(expr);
        // Reset to neutral after a bit
        setTimeout(() => {
          if (this.currentState === 'idle' || this.currentState === 'followup') {
            this._setExpressionByIntent('neutral');
          }
        }, 4000);
      }
    }, 12000 + Math.random() * 6000); // Every 12-18 seconds
  }

  _stopIdleVariety() {
    if (this._idleVarietyInterval) {
      clearInterval(this._idleVarietyInterval);
      this._idleVarietyInterval = null;
    }
  }

  // ===== Feature 4: Idle Timeout (Sleepy) =====

  _startIdleTimeout() {
    this._clearIdleTimeout();
    this._lastInteractionTime = Date.now();
    this._isIdleTimeout = false;

    // Check every 5 seconds if we should go sleepy
    this._idleTimeoutHandle = setInterval(() => {
      if (!this.model || !this.isLoaded) return;
      if (this.currentState !== 'idle' && this.currentState !== 'followup') {
        // Active state resets the timer
        this._lastInteractionTime = Date.now();
        return;
      }
      if (this._isIdleTimeout) return; // Already sleeping

      const elapsed = Date.now() - this._lastInteractionTime;
      if (elapsed > 30000) {
        // 30 seconds of no interaction → go sleepy
        this._enterIdleTimeout();
      }
    }, 5000);
  }

  _clearIdleTimeout() {
    if (this._idleTimeoutHandle) {
      clearInterval(this._idleTimeoutHandle);
      this._idleTimeoutHandle = null;
    }
  }

  _enterIdleTimeout() {
    if (this._isIdleTimeout) return;
    this._isIdleTimeout = true;
    console.log('[Live2D] Idle timeout → sleepy mode');

    this._setExpressionByIntent('sleepy');
    // Slow idle motion
    this._playMotion('Idle', 0);
  }

  _wakeFromIdleTimeout() {
    if (!this._isIdleTimeout) return;
    this._isIdleTimeout = false;
    console.log('[Live2D] Waking from sleepy mode');

    // Surprise wake-up!
    this._setExpressionByIntent('surprised');
    const tap = this._getTapGroup();
    this._playMotion(tap, 0);

    setTimeout(() => {
      if (this.currentState === 'idle' || this.currentState === 'followup') {
        this._setExpressionByIntent('neutral');
      }
    }, 1500);
  }

  _onUserInteraction() {
    this._lastInteractionTime = Date.now();
    if (this._isIdleTimeout) {
      this._wakeFromIdleTimeout();
    }
  }

  // ===== Feature 5: Proximity Reaction =====

  _handleProximity(localX, localY) {
    if (!this.model || !this.isLoaded) return;

    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;

    // Calculate distance from cursor to center of model (normalized 0-1)
    const centerX = containerW / 2;
    const centerY = containerH / 2;
    const dx = (localX - centerX) / containerW;
    const dy = (localY - centerY) / containerH;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Normalize: 0 = on top of model, 1 = far away
    this._cursorProximity = Math.min(1, dist * 2.5);

    // When cursor is very close, model gets slightly excited
    if (this._cursorProximity < 0.2 && this.currentState === 'idle') {
      // Subtle eye widening when cursor is near
      this._setParam('ParamEyeEffect', (0.2 - this._cursorProximity) * 3);
    } else {
      this._setParam('ParamEyeEffect', 0);
    }
  }

  // ===== Feature 6: Heart Effect =====

  _triggerHeartEffect() {
    console.log('[Live2D] Triggering heart effect');

    // Use a PIXI ticker for heart animation so it applies every frame
    let t = 0;
    const heartTicker = () => {
      t += 0.02;

      if (t <= 1.0) {
        // Phase 1: Grow in (0-1s)
        this._setParam('ParamHeartHealOn', 1);         // Enable heal hearts display
        this._setParam('ParamHeartBackHealOn', 1);      // Enable back hearts
        this._setParam('ParamHeartDrow', 1);            // Draw hearts
        this._setParam('ParamHeartSize', Math.min(1, t * 1.5));  // Grow size
        this._setParam('ParamHeartColorLight', 1);      // Light color
        this._setParam('ParamHeartColorHeal', 1);       // Heal color (green)
        // Also try the light/star effect
        this._setParam('ParamHeartLightOn', 1);
        this._setParam('ParamHeartLight', Math.min(1, t * 2));
      } else if (t <= 2.0) {
        // Phase 2: Hold + fade out (1-2s)
        const fade = 2.0 - t;
        this._setParam('ParamHeartDrow', fade);
        this._setParam('ParamHeartSize', 0.8 + fade * 0.2);
        this._setParam('ParamHeartLight', fade);
      } else {
        // Phase 3: Clean up
        if (this.app && this.app.ticker) {
          this.app.ticker.remove(heartTicker);
        }
        this._setParam('ParamHeartHealOn', 0);
        this._setParam('ParamHeartBackHealOn', 0);
        this._setParam('ParamHeartDrow', 0);
        this._setParam('ParamHeartSize', 0);
        this._setParam('ParamHeartColorLight', 0);
        this._setParam('ParamHeartColorHeal', 0);
        this._setParam('ParamHeartLightOn', 0);
        this._setParam('ParamHeartLight', 0);
        this._setParam('ParamHeartMissOn', 0);
        this._setParam('ParamHeartBackMissOn', 0);
        console.log('[Live2D] Heart effect ended');
      }
    };

    if (this.app && this.app.ticker) {
      this.app.ticker.add(heartTicker);
    }
  }

  // ===== Motion & Expression Helpers =====

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

  // ===== Mouse Interaction =====
  _setupInteraction() {
    if (!this.model || !this.container) return;

    this._cleanupInteraction();

    // Enable pointer events on the live2d canvas so PIXI receives them
    const canvas = document.getElementById('live2d-canvas');
    if (canvas) canvas.style.pointerEvents = 'auto';

    // Make model interactive for PIXI hit-testing
    this.model.interactive = true;
    this.model.buttonMode = true;

    // Hit-area-aware tap handler
    this._onModelTap = (e) => this._handleTap(e);
    this.model.on('pointertap', this._onModelTap);

    // Track mouse via DOM for focus + proximity
    this._onPointerMove = (e) => {
      if (!this.model || !this.isLoaded) return;
      const rect = this.container.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      // Eye/head tracking
      this.model.focus(localX, localY);

      // Proximity detection
      this._handleProximity(localX, localY);

      // Any mouse movement counts as interaction
      this._onUserInteraction();
    };
    this.container.addEventListener('pointermove', this._onPointerMove);

    console.log('[Live2D] Interactive features enabled (hit areas, breathing, idle variety, proximity, idle timeout)');
  }

  _cleanupInteraction() {
    if (this.model && this._onModelTap) {
      this.model.off('pointertap', this._onModelTap);
      this._onModelTap = null;
    }
    if (this._onPointerMove) {
      this.container.removeEventListener('pointermove', this._onPointerMove);
      this._onPointerMove = null;
    }
    const canvas = document.getElementById('live2d-canvas');
    if (canvas) canvas.style.pointerEvents = 'none';
  }

  _stopInteractiveFeatures() {
    this._stopBreathing();
    this._stopIdleVariety();
    this._clearIdleTimeout();
    this._stopLipSyncTicker();
    clearTimeout(this._headPatResetTimer);
    this._headPatCount = 0;
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
    this._cleanupInteraction();
    this._stopInteractiveFeatures();

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
