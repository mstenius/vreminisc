// motion-look.js — Device orientation / gyro look module for VReminisc
import * as THREE from 'three';
import {
  IS_SAFARI,
  IS_IOS,
  MAX_COMPASS_ACCURACY_DEGREES,
  MOTION_BUTTON_LABEL,
  MOTION_BUTTON_ACTIVE_LABEL,
} from './config.js';

/**
 * createMotionLook({ motionButton, onMotionSample, onStatusMessage, onActivate, isPresenting })
 *
 * @param {HTMLElement}   motionButton      - The toolbar button element
 * @param {Function}      onMotionSample    - Called with (yaw, pitch) on each orientation event when active
 * @param {Function}      onStatusMessage   - Called with (message, duration?) to show a status message
 * @param {Function}      onActivate        - Called when motion look is successfully activated (e.g. hide hint)
 * @param {Function}      isPresenting      - Returns true when XR session is active
 *
 * @returns {{ init(), toggle(), disable(msg?), isActive(), dispose() }}
 */
export function createMotionLook({ motionButton, onMotionSample, onStatusMessage, onActivate, isPresenting }) {
  let motionLookActive = false;
  let lastMotionSample = null;

  // ── Button state ─────────────────────────────────────────────

  function updateMotionButton() {
    if (!motionButton) return;
    motionButton.textContent = motionLookActive ? MOTION_BUTTON_ACTIVE_LABEL : MOTION_BUTTON_LABEL;
    motionButton.ariaPressed = motionLookActive ? 'true' : 'false';
    motionButton.classList.toggle('toolbar-button-active', motionLookActive);
    motionButton.disabled = isPresenting();
  }

  // ── Support detection ────────────────────────────────────────

  function supportsMotionLookUi() {
    return 'DeviceOrientationEvent' in window
      && (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches);
  }

  function shouldShowMotionButton() {
    return supportsMotionLookUi() || (IS_SAFARI && IS_IOS);
  }

  // ── Sensor math ──────────────────────────────────────────────

  function getMotionAlphaRadians(event) {
    const compassHeading = event.webkitCompassHeading;
    const compassAccuracy = event.webkitCompassAccuracy;
    const hasUsableCompassHeading = typeof compassHeading === 'number'
      && !Number.isNaN(compassHeading)
      && (typeof compassAccuracy !== 'number'
        || Number.isNaN(compassAccuracy)
        || compassAccuracy <= MAX_COMPASS_ACCURACY_DEGREES);

    if (hasUsableCompassHeading) {
      return THREE.MathUtils.degToRad(360 - compassHeading);
    }

    if (event.alpha == null) return null;
    return THREE.MathUtils.degToRad(event.alpha);
  }

  function getMotionPitchRadians(event) {
    if (event.beta == null) return null;
    return THREE.MathUtils.degToRad(event.beta - 90);
  }

  // ── Orientation handler ──────────────────────────────────────

  function handleDeviceOrientation(event) {
    const alpha = getMotionAlphaRadians(event);
    const nextPitch = getMotionPitchRadians(event);
    if (alpha == null || nextPitch == null) return;

    lastMotionSample = { yaw: alpha, pitch: nextPitch };

    if (!motionLookActive || isPresenting()) return;

    onMotionSample(lastMotionSample.yaw, lastMotionSample.pitch);
  }

  // ── Permission ───────────────────────────────────────────────

  async function requestMotionPermission() {
    if (!supportsMotionLookUi()) return false;

    const requestPermission = DeviceOrientationEvent.requestPermission;
    if (typeof requestPermission !== 'function') return true;

    try {
      return (await requestPermission.call(DeviceOrientationEvent)) === 'granted';
    } catch (e) {
      console.error('Failed to request device orientation permission:', e);
      return false;
    }
  }

  // ── Public API ───────────────────────────────────────────────

  async function toggle() {
    if (isPresenting()) return;

    if (motionLookActive) {
      disable('Motion look disabled');
      return;
    }

    if (!window.isSecureContext) {
      onStatusMessage('Motion look requires HTTPS on mobile browsers', 3600);
      return;
    }

    if (!supportsMotionLookUi()) {
      onStatusMessage(
        IS_SAFARI && IS_IOS
          ? 'Motion sensors are unavailable in this Safari context'
          : 'Motion sensors are not available on this device'
      );
      return;
    }

    const permissionGranted = await requestMotionPermission();
    if (!permissionGranted) {
      onStatusMessage('Motion permission was denied', 3200);
      return;
    }

    motionLookActive = true;
    updateMotionButton();

    if (lastMotionSample) {
      onMotionSample(lastMotionSample.yaw, lastMotionSample.pitch);
    }

    onStatusMessage('Move the device to look around');
    if (onActivate) onActivate();
  }

  function disable(statusMessage = '') {
    if (motionLookActive) {
      motionLookActive = false;
      if (statusMessage) onStatusMessage(statusMessage);
    }
    // Always sync button state (e.g. re-enable after XR session ends)
    updateMotionButton();
  }

  function isActive() {
    return motionLookActive;
  }

  function init() {
    if (!motionButton || !shouldShowMotionButton()) return;

    motionButton.hidden = false;
    motionButton.addEventListener('click', toggle);
    updateMotionButton();

    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
  }

  function dispose() {
    window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
    if (motionButton) motionButton.removeEventListener('click', toggle);
  }

  return { init, toggle, disable, isActive, dispose };
}
