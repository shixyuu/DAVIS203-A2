/**
 * Soundscape Interface Stub
 *
 * Dedicated clean interface for sound design integration:
 * - init(): Triggered when the user clicks to start (unlocks Web Audio context/playback permissions)
 * - setAudioSources({ calmUrl, chaoticUrl }): Configure quiet ambient and chaotic public environment tracks
 * - onIntensityChange(entropy): Per-frame callback when interaction intensity (0.0 ~ 1.0) shifts
 * - onTouchEvent({ nx, ny, action, deviceId }): Real-time callback on tap or swipe events
 */

export class SoundscapeInterface {
  constructor() {
    this.initialized = false;
    this.sources = {
      calmUrl: null,    // Ambient natural audio source URL
      chaoticUrl: null, // Public environment noise audio source URL
    };
  }

  /**
   * Called when user clicks "Start"
   */
  async init() {
    this.initialized = true;
    // AudioContext or Audio element initialization can be added here
  }

  /**
   * Set custom audio tracks
   * @param {{ calmUrl?: string, chaoticUrl?: string }} config
   */
  setAudioSources(config = {}) {
    this.sources = { ...this.sources, ...config };
  }

  /**
   * Intensity callback
   * @param {number} entropy 0.0 (calm) -> 1.0 (intense)
   */
  onIntensityChange(entropy) {
    if (!this.initialized) return;
    // Dynamic mixing logic based on entropy level can be connected here
  }

  /**
   * Touch event callback
   * @param {{ nx: number, ny: number, action: string, deviceId?: string }} event
   */
  onTouchEvent(event) {
    if (!this.initialized) return;
    // Transient acoustic grains can be triggered here
  }
}
