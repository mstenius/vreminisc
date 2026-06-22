// camera-controller.js — Non-gyro look + zoom for VReminisc
// Owns yaw / pitch / fov and handles all pointer, touch (drag + pinch),
// wheel and keyboard input. Motion look (motion-look.js) drives rotation
// through setYawPitch; this module yields to it while it is active.
import * as THREE from 'three';
import { MIN_FOV, MAX_FOV, WHEEL_ZOOM_SPEED } from './config.js';

const KEY_PAN_SPEED = 0.022; // radians per frame at 60 fps
const DRAG_SPEED = 0.003;    // radians per pixel
const HALF_PI = Math.PI / 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}

/**
 * createCameraController(canvas, camera, { isVRActive, isMotionActive, onInteract })
 *
 * @param {HTMLCanvasElement} canvas         - The WebGL canvas (pointer/wheel target)
 * @param {THREE.PerspectiveCamera} threeCam   - The non-VR camera (owns fov + rotation)
 * @param {Function}      isVRActive        - Returns true when an XR session is active
 * @param {Function}      isMotionActive      - Returns true when motion look owns rotation
 * @param {Function}      onInteract          - Called on the first input of a gesture (e.g. hide hint)
 *
 * Listeners are registered on construction (mirroring the original load-time
 * binding). yaw/pitch/fov are private; read via getters, set via setYawPitch/setFov.
 *
 * @returns {{ update(), getYaw(), getPitch(), setYawPitch(y, p), setFov(fov), getFov(), dispose() }}
 */
export function createCameraController(canvas, threeCam, { isVRActive, isMotionActive = () => false, onInteract } = {}) {
  let yaw = 0;
  let pitch = 0;
  let primaryPointerId = null;
  let prevX = 0;
  let prevY = 0;
  let pinchStartDistance = 0;
  let pinchStartFov = threeCam.fov;
  const activePointers = new Map();
  const pressedKeys = new Set();

  function notifyInteract() {
    if (onInteract) onInteract();
  }

  function applyRotation() {
    threeCam.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  // ── Public state accessors ───────────────────────────────────

  function getYaw() {
    return yaw;
  }

  function getPitch() {
    return pitch;
  }

  function setYawPitch(nextYaw, nextPitch) {
    yaw = normalizeAngle(nextYaw);
    pitch = clamp(nextPitch, -HALF_PI, HALF_PI);
    applyRotation();
  }

  function setFov(nextFov) {
    threeCam.fov = clamp(nextFov, MIN_FOV, MAX_FOV);
    threeCam.updateProjectionMatrix();
  }

  function getFov() {
    return threeCam.fov;
  }

  // ── Pointer gesture state ────────────────────────────────────

  function getPinchDistance() {
    if (activePointers.size < 2) return 0;
    const [first, second] = Array.from(activePointers.values());
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function syncPointerGestureState() {
    if (activePointers.size === 1) {
      const [[pointerId, pointer]] = activePointers.entries();
      primaryPointerId = pointerId;
      prevX = pointer.x;
      prevY = pointer.y;
      pinchStartDistance = 0;
      pinchStartFov = threeCam.fov;
      return;
    }

    primaryPointerId = null;

    if (activePointers.size >= 2) {
      pinchStartDistance = getPinchDistance();
      pinchStartFov = threeCam.fov;
      return;
    }

    pinchStartDistance = 0;
    pinchStartFov = threeCam.fov;
  }

  // ── Pointer / wheel handlers ─────────────────────────────────

  function handlePointerDown(e) {
    if (isVRActive()) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    syncPointerGestureState();
    canvas.setPointerCapture(e.pointerId);
    notifyInteract();
  }

  function handlePointerUp(e) {
    activePointers.delete(e.pointerId);
    syncPointerGestureState();
  }

  function handlePointerCancel(e) {
    activePointers.delete(e.pointerId);
    syncPointerGestureState();
  }

  function handlePointerMove(e) {
    if (isVRActive() || !activePointers.has(e.pointerId)) return;

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size >= 2) {
      const pinchDistance = getPinchDistance();
      if (pinchStartDistance > 0 && pinchDistance > 0) {
        setFov(pinchStartFov / (pinchDistance / pinchStartDistance));
        notifyInteract();
      }
      return;
    }

    if (isMotionActive()) return;

    if (primaryPointerId !== e.pointerId) return;

    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX;
    prevY = e.clientY;
    const fovScale = threeCam.fov / MAX_FOV;
    yaw   += dx * DRAG_SPEED * fovScale;
    pitch += dy * DRAG_SPEED * fovScale;
    pitch = clamp(pitch, -HALF_PI, HALF_PI);
    applyRotation();
  }

  function handleWheel(e) {
    if (isVRActive()) return;
    e.preventDefault();
    setFov(threeCam.fov + e.deltaY * WHEEL_ZOOM_SPEED);
    notifyInteract();
  }

  // ── Keyboard arrow-key panning ───────────────────────────────

  function handleKeyDown(e) {
    const tag = document.activeElement?.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      pressedKeys.add(e.key);
    }
  }

  function handleKeyUp(e) {
    pressedKeys.delete(e.key);
  }

  /** Call once per animation frame; accumulates held-arrow-key rotation. */
  function update() {
    if (isVRActive() || isMotionActive() || pressedKeys.size === 0) return;
    if (pressedKeys.has('ArrowLeft'))  yaw += KEY_PAN_SPEED;
    if (pressedKeys.has('ArrowRight')) yaw -= KEY_PAN_SPEED;
    if (pressedKeys.has('ArrowUp'))    pitch = Math.max(-HALF_PI, pitch + KEY_PAN_SPEED);
    if (pressedKeys.has('ArrowDown'))  pitch = Math.min(HALF_PI, pitch - KEY_PAN_SPEED);
    applyRotation();
  }

  // ── Listener registration ────────────────────────────────────

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerCancel);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  function dispose() {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerCancel);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('wheel', handleWheel);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  }

  return { update, getYaw, getPitch, setYawPitch, setFov, getFov, dispose };
}
