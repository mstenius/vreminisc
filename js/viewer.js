// vreminisc — A 360 degree equirectangular photo viewer
// Uses Three.js for WebXR.
// Place user inside a textured sphere.
// VR mode hands tracking to the headset, desktop/mobile mode uses drag-to-look and zoom.

import * as THREE from 'three';

// ── Photo discovery ───────────────────────────────────────────
// Prefer a static manifest so photo discovery is independent of the HTTP server.
// Fall back to HTML directory listings when available for convenience.
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
const APP_CONFIG_PATH = 'app.config.json';
const DEFAULT_TEXTURE_MEDIA_PATHS = ['media/textures/'];
const DEFAULT_APP_CONFIG = Object.freeze({
  pageTitle: document.title,
  textureMediaPaths: DEFAULT_TEXTURE_MEDIA_PATHS,
});
const IS_SAFARI = /^((?!chrome|chromium|crios|edg|opr|fxios|android).)*safari/i.test(navigator.userAgent);
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function normalizeTextureMediaPath(path) {
  if (typeof path !== 'string') return '';

  const trimmedPath = path.trim();
  if (!trimmedPath) return '';
  return trimmedPath.endsWith('/') ? trimmedPath : `${trimmedPath}/`;
}

function normalizeTextureMediaPaths(paths) {
  if (!Array.isArray(paths)) return DEFAULT_TEXTURE_MEDIA_PATHS;

  const normalizedPaths = [...new Set(paths.map(normalizeTextureMediaPath).filter(Boolean))];
  return normalizedPaths.length > 0 ? normalizedPaths : DEFAULT_TEXTURE_MEDIA_PATHS;
}

function normalizeAppConfig(config) {
  return {
    pageTitle: typeof config?.pageTitle === 'string' && config.pageTitle.trim()
      ? config.pageTitle.trim()
      : DEFAULT_APP_CONFIG.pageTitle,
    textureMediaPaths: normalizeTextureMediaPaths(config?.textureMediaPaths),
  };
}

async function loadAppConfig() {
  try {
    const res = await fetch(APP_CONFIG_PATH, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_APP_CONFIG;

    const config = await res.json().catch(() => null);
    return normalizeAppConfig(config);
  } catch (e) {
    console.warn('Failed to load app config:', e);
    return DEFAULT_APP_CONFIG;
  }
}

function applyAppConfig(config) {
  document.title = config.pageTitle;
}

function getMediaBaseUrl(textureMediaPath) {
  return new URL(textureMediaPath, window.location.href);
}

function getPhotosManifestUrl(textureMediaPath) {
  return new URL('photos.json', getMediaBaseUrl(textureMediaPath)).href;
}

function humanizePhotoName(filename) {
  return decodeURIComponent(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ');
}

function toPhoto(textureMediaPath, entry, title = '') {
  if (typeof entry !== 'string' || !IMAGE_RE.test(entry)) return null;

  const url = new URL(entry, getMediaBaseUrl(textureMediaPath));
  const filename = url.pathname.split('/').pop();
  if (!filename) return null;

  return {
    name: title || humanizePhotoName(filename),
    url: url.href,
  };
}

function normalizeManifestEntry(textureMediaPath, entry) {
  if (typeof entry === 'string') {
    return toPhoto(textureMediaPath, entry);
  }

  if (!entry || typeof entry !== 'object') return null;

  const file = typeof entry.file === 'string'
    ? entry.file
    : typeof entry.url === 'string'
      ? entry.url
      : '';
  const title = typeof entry.title === 'string'
    ? entry.title.trim()
    : typeof entry.name === 'string'
      ? entry.name.trim()
      : '';
  return toPhoto(textureMediaPath, file, title);
}

async function discoverPhotosFromManifest(textureMediaPath) {
  const res = await fetch(getPhotosManifestUrl(textureMediaPath), { cache: 'no-store' });
  if (!res.ok) return [];

  const manifest = await res.json().catch(() => null);
  if (!Array.isArray(manifest)) return [];

  return manifest
    .map((entry) => normalizeManifestEntry(textureMediaPath, entry))
    .filter(Boolean);
}

async function discoverPhotosFromDirectoryListing(textureMediaPath) {
  const res = await fetch(textureMediaPath);
  if (!res.ok) return [];

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => a.getAttribute('href'))
    .map((href) => href ? toPhoto(textureMediaPath, href) : null)
    .filter(Boolean);
}

async function discoverPhotosInPath(textureMediaPath) {
  const manifestPhotos = await discoverPhotosFromManifest(textureMediaPath);
  if (manifestPhotos.length > 0) return manifestPhotos;
  return discoverPhotosFromDirectoryListing(textureMediaPath);
}

function dedupePhotos(photos) {
  const seenUrls = new Set();

  return photos.filter((photo) => {
    if (seenUrls.has(photo.url)) return false;
    seenUrls.add(photo.url);
    return true;
  });
}

async function discoverPhotos(textureMediaPaths) {
  const photoLists = await Promise.all(textureMediaPaths.map(discoverPhotosInPath));
  return dedupePhotos(photoLists.flat());
}

// ── DOM refs ──────────────────────────────────────────────────
const canvas = document.getElementById('glcanvas');
const header = document.querySelector('header');
const photoSelect = document.getElementById('photoSelect');
const vrButtonContainer = document.getElementById('vrButtonContainer');
const loadStatus = document.getElementById('loadStatus');
const motionButton = document.getElementById('motionButton');
const fullscreenButton = document.getElementById('fullscreenButton');
const hint = document.getElementById('hint');

// ── Renderer ──────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;

// ── Scene ─────────────────────────────────────────────────────
const scene = new THREE.Scene();

// PerspectiveCamera used for non-VR rendering. In VR mode Three.js
// internally uses XR tracking cameras instead; this camera's near/far
// are inherited by them.
const INITIAL_FOV = 75;
const MIN_FOV = 20;
const MAX_FOV = 90;
const WHEEL_ZOOM_SPEED = 0.05;
const FULLSCREEN_UI_HIDE_DELAY = 1800;
const FULLSCREEN_UI_REVEAL_ZONE = 72;
const STATUS_MESSAGE_DURATION = 2800;
const MAX_COMPASS_ACCURACY_DEGREES = 45;
const camera = new THREE.PerspectiveCamera(INITIAL_FOV, canvas.clientWidth / canvas.clientHeight, 0.1, 1100);
const fullscreenRoot = document.documentElement;
const MOTION_BUTTON_LABEL = 'Motion Look';
const MOTION_BUTTON_ACTIVE_LABEL = 'Stop Motion';

// ── Photo sphere ──────────────────────────────────────────────
// Scale X by -1 to flip winding order so the texture renders on the
// interior surface. Radius 500 — any room-scale VR movement is negligible.
const sphereGeo = new THREE.SphereGeometry(500, 60, 40);
sphereGeo.scale(-1, 1, 1);

const sphereMat = new THREE.MeshBasicMaterial();
const sphere = new THREE.Mesh(sphereGeo, sphereMat);
scene.add(sphere);

const texLoader = new THREE.TextureLoader();

function loadPhoto({ name, url }) {
  loadStatus.textContent = `Loading ${name}…`;

  texLoader.load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const prev = sphereMat.map;
      sphereMat.map = tex;
      setCameraFov(INITIAL_FOV);
      sphereMat.needsUpdate = true;
      if (prev) prev.dispose();
      loadStatus.textContent = '';
    },
    undefined,
    () => {
      loadStatus.textContent = `Failed to load ${name}`;
    }
  );
}

// ── Drag-to-look + zoom (pointer events handle mouse + touch uniformly) ──
let yaw = 0;
let pitch = 0;
let primaryPointerId = null;
let prevX = 0;
let prevY = 0;
let pinchStartDistance = 0;
let pinchStartFov = camera.fov;
let fullscreenUiHideTimeout = 0;
let statusMessageTimeout = 0;
let motionLookActive = false;
let lastMotionSample = null;
const activePointers = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}

function setCameraFov(nextFov) {
  camera.fov = clamp(nextFov, MIN_FOV, MAX_FOV);
  camera.updateProjectionMatrix();
}

function setStatusMessage(message, duration = STATUS_MESSAGE_DURATION) {
  if (!loadStatus) return;

  if (statusMessageTimeout) {
    window.clearTimeout(statusMessageTimeout);
    statusMessageTimeout = 0;
  }

  loadStatus.textContent = message;

  if (duration <= 0) return;

  statusMessageTimeout = window.setTimeout(() => {
    statusMessageTimeout = 0;
    if (loadStatus.textContent === message) {
      loadStatus.textContent = '';
    }
  }, duration);
}

function supportsMotionLookUi() {
  return 'DeviceOrientationEvent' in window
    && (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches);
}

function shouldShowMotionButton() {
  return supportsMotionLookUi() || (IS_SAFARI && IS_IOS);
}

function updateMotionButton() {
  if (!motionButton) return;

  motionButton.textContent = motionLookActive ? MOTION_BUTTON_ACTIVE_LABEL : MOTION_BUTTON_LABEL;
  motionButton.ariaPressed = motionLookActive ? 'true' : 'false';
  motionButton.classList.toggle('toolbar-button-active', motionLookActive);
  motionButton.disabled = renderer.xr.isPresenting;
}

function disableMotionLook(statusMessage = '') {
  if (!motionLookActive) return;

  motionLookActive = false;
  updateMotionButton();
  applyRotation();

  if (statusMessage) {
    setStatusMessage(statusMessage);
  }
}

function applyMotionLook(nextYaw, nextPitch) {
  yaw = normalizeAngle(nextYaw);
  pitch = clamp(nextPitch, -Math.PI / 2, Math.PI / 2);
  applyRotation();
}

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

function handleDeviceOrientation(event) {
  const alpha = getMotionAlphaRadians(event);
  const nextPitch = getMotionPitchRadians(event);
  if (alpha == null || nextPitch == null) return;

  lastMotionSample = {
    yaw: alpha,
    pitch: nextPitch,
  };

  if (!motionLookActive || renderer.xr.isPresenting) return;

  applyMotionLook(lastMotionSample.yaw, lastMotionSample.pitch);
}

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

async function toggleMotionLook() {
  if (renderer.xr.isPresenting) return;

  if (motionLookActive) {
    disableMotionLook('Motion look disabled');
    return;
  }

  if (!window.isSecureContext) {
    setStatusMessage('Motion look requires HTTPS on mobile browsers', 3600);
    return;
  }

  if (!supportsMotionLookUi()) {
    setStatusMessage(
      IS_SAFARI && IS_IOS
        ? 'Motion sensors are unavailable in this Safari context'
        : 'Motion sensors are not available on this device'
    );
    return;
  }

  const permissionGranted = await requestMotionPermission();
  if (!permissionGranted) {
    setStatusMessage('Motion permission was denied', 3200);
    return;
  }

  motionLookActive = true;
  updateMotionButton();

  if (lastMotionSample) {
    applyMotionLook(lastMotionSample.yaw, lastMotionSample.pitch);
  }

  setStatusMessage('Move the device to look around');
  hideHint();
}

function initMotionLook() {
  if (!motionButton || !shouldShowMotionButton()) return;

  motionButton.hidden = false;
  motionButton.addEventListener('click', toggleMotionLook);
  updateMotionButton();

  window.addEventListener('deviceorientation', handleDeviceOrientation, true);
}

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
    pinchStartFov = camera.fov;
    return;
  }

  primaryPointerId = null;

  if (activePointers.size >= 2) {
    pinchStartDistance = getPinchDistance();
    pinchStartFov = camera.fov;
    return;
  }

  pinchStartDistance = 0;
  pinchStartFov = camera.fov;
}

function applyRotation() {
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function supportsFullscreen() {
  return Boolean(
    document.fullscreenEnabled
    || document.webkitFullscreenEnabled
    || fullscreenRoot.requestFullscreen
    || fullscreenRoot.webkitRequestFullscreen
  );
}

async function requestFullscreen() {
  if (fullscreenRoot.requestFullscreen) {
    await fullscreenRoot.requestFullscreen();
    return;
  }

  if (fullscreenRoot.webkitRequestFullscreen) {
    await Promise.resolve(fullscreenRoot.webkitRequestFullscreen());
  }
}

async function exitFullscreen() {
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }

  if (document.webkitExitFullscreen) {
    await Promise.resolve(document.webkitExitFullscreen());
  }
}

function updateFullscreenButton() {
  if (!fullscreenButton) return;

  const isFullscreen = Boolean(getFullscreenElement());
  fullscreenButton.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
  fullscreenButton.ariaPressed = isFullscreen ? 'true' : 'false';
  fullscreenButton.disabled = renderer.xr.isPresenting;
}

function clearFullscreenUiHideTimeout() {
  if (!fullscreenUiHideTimeout) return;
  window.clearTimeout(fullscreenUiHideTimeout);
  fullscreenUiHideTimeout = 0;
}

function isFullscreenBrowserMode() {
  return Boolean(getFullscreenElement()) && !renderer.xr.isPresenting;
}

function showFullscreenUi() {
  if (!header) return;
  header.classList.remove('hidden-in-fullscreen');
}

function hideFullscreenUi() {
  if (!header || !isFullscreenBrowserMode()) return;
  header.classList.add('hidden-in-fullscreen');
}

function scheduleFullscreenUiHide() {
  clearFullscreenUiHideTimeout();

  if (!isFullscreenBrowserMode()) {
    showFullscreenUi();
    return;
  }

  fullscreenUiHideTimeout = window.setTimeout(() => {
    fullscreenUiHideTimeout = 0;
    hideFullscreenUi();
  }, FULLSCREEN_UI_HIDE_DELAY);
}

function syncFullscreenUiState() {
  const fullscreenActive = isFullscreenBrowserMode();
  document.body.classList.toggle('fullscreen-active', fullscreenActive);

  if (!fullscreenActive) {
    clearFullscreenUiHideTimeout();
    showFullscreenUi();
    return;
  }

  showFullscreenUi();
  scheduleFullscreenUiHide();
}

async function toggleFullscreen() {
  if (renderer.xr.isPresenting) return;

  if (!supportsFullscreen()) {
    setStatusMessage(
      IS_SAFARI && IS_IOS
        ? 'Fullscreen is limited in iPhone Safari'
        : 'Fullscreen is not supported in this browser',
      3600
    );
    return;
  }

  hideHint();

  try {
    if (getFullscreenElement()) {
      await exitFullscreen();
      return;
    }

    await requestFullscreen();
  } catch (e) {
    console.error('Failed to toggle fullscreen:', e);
  }
}

function initFullscreen() {
  if (!fullscreenButton || !supportsFullscreen()) return;

  fullscreenButton.hidden = false;
  fullscreenButton.addEventListener('click', toggleFullscreen);
  updateFullscreenButton();

  const handleFullscreenChange = () => {
    updateFullscreenButton();
    syncFullscreenUiState();
    onResize();
  };

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

  document.addEventListener('pointermove', (e) => {
    if (!isFullscreenBrowserMode()) return;
    if (e.clientY > FULLSCREEN_UI_REVEAL_ZONE && !header?.matches(':hover')) return;
    showFullscreenUi();
    scheduleFullscreenUiHide();
  });

  if (header) {
    header.addEventListener('pointerenter', () => {
      if (!isFullscreenBrowserMode()) return;
      showFullscreenUi();
      clearFullscreenUiHideTimeout();
    });

    header.addEventListener('pointerleave', () => {
      scheduleFullscreenUiHide();
    });
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  syncPointerGestureState();
  canvas.setPointerCapture(e.pointerId);
  hideHint();
});

canvas.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  syncPointerGestureState();
});

canvas.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  syncPointerGestureState();
});

canvas.addEventListener('pointermove', (e) => {
  if (renderer.xr.isPresenting || !activePointers.has(e.pointerId)) return;

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size >= 2) {
    const pinchDistance = getPinchDistance();
    if (pinchStartDistance > 0 && pinchDistance > 0) {
      setCameraFov(pinchStartFov / (pinchDistance / pinchStartDistance));
      hideHint();
    }
    return;
  }

  if (motionLookActive) return;

  if (primaryPointerId !== e.pointerId) return;

  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  prevX = e.clientX;
  prevY = e.clientY;
  yaw   += dx * 0.003;
  pitch += dy * 0.003;
  pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
  applyRotation();
});

canvas.addEventListener('wheel', (e) => {
  if (renderer.xr.isPresenting) return;
  e.preventDefault();
  setCameraFov(camera.fov + e.deltaY * WHEEL_ZOOM_SPEED);
  hideHint();
}, { passive: false });

// ── Resize ────────────────────────────────────────────────────
function onResize() {
  if (renderer.xr.isPresenting) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

// ── Hint overlay ──────────────────────────────────────────────
let hintHidden = false;

function hideHint() {
  if (hintHidden) return;
  hintHidden = true;
  hint.classList.add('hidden');
  setTimeout(() => { hint.remove(); }, 600);
}

// ── VR Menu ───────────────────────────────────────────────────
const VR_MENU_CANVAS_W = 600;
const VR_MENU_CANVAS_H = 560;
const VR_MENU_WIDTH = 1.4;
const VR_MENU_HEIGHT = 1.3;
const VR_MENU_DISTANCE = 1.8;
const VR_MENU_PHOTOS_PER_PAGE = 7;
const VR_DWELL_MS = 1500;

let vrMenuGroup = null;
let vrMenuMesh = null;
let vrMenuCanvas = null;
let vrMenuCtx = null;
let vrMenuTexture = null;
let vrMenuVisible = false;
let vrMenuHoveredId = null;
let vrMenuPhotoPage = 0;
const xrControllers = [];
const xrControllerRays = [];
let vrGazeCursor = null;
let vrDwellTarget = null;
let vrDwellStart = 0;

const _vrRayOrigin = new THREE.Vector3();
const _vrRayDir = new THREE.Vector3();
const _vrRaycaster = new THREE.Raycaster();

function getVRMenuHitboxes() {
  const W = VR_MENU_CANVAS_W;
  const H = VR_MENU_CANVAS_H;
  const boxes = [
    { id: 'close', x: 534, y: 24, w: 44, h: 44 },
    { id: 'exit', x: 32, y: 24, w: 480, h: 52 },
  ];
  const pageStart = vrMenuPhotoPage * VR_MENU_PHOTOS_PER_PAGE;
  const pageEnd = Math.min(pageStart + VR_MENU_PHOTOS_PER_PAGE, photos.length);
  for (let i = pageStart; i < pageEnd; i++) {
    boxes.push({ id: `photo:${i}`, x: 32, y: 122 + (i - pageStart) * 48, w: W - 64, h: 42 });
  }
  if (vrMenuPhotoPage > 0) {
    boxes.push({ id: 'prev', x: 32, y: H - 68, w: 120, h: 40 });
  }
  if ((vrMenuPhotoPage + 1) * VR_MENU_PHOTOS_PER_PAGE < photos.length) {
    boxes.push({ id: 'next', x: W - 152, y: H - 68, w: 120, h: 40 });
  }
  return boxes;
}

function vrMenuRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawVRMenu() {
  if (!vrMenuCtx || !photos.length) return;
  const ctx = vrMenuCtx;
  const W = VR_MENU_CANVAS_W;
  const H = VR_MENU_CANVAS_H;
  const hov = vrMenuHoveredId;
  const currentPhotoIdx = photoSelect.value !== '' ? Number(photoSelect.value) : 0;

  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(8,10,18,0.93)';
  vrMenuRoundRect(ctx, 8, 8, W - 16, H - 16, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  vrMenuRoundRect(ctx, 8, 8, W - 16, H - 16, 20);
  ctx.stroke();

  const boxes = getVRMenuHitboxes();

  for (const box of boxes) {
    const isHov = hov === box.id;

    if (box.id === 'close') {
      ctx.fillStyle = isHov ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)';
      vrMenuRoundRect(ctx, box.x, box.y, box.w, box.h, 8);
      ctx.fill();
      ctx.fillStyle = isHov ? '#fff' : '#888';
      ctx.font = '20px system-ui, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', box.x + box.w / 2, box.y + box.h / 2);

    } else if (box.id === 'exit') {
      ctx.fillStyle = isHov ? 'rgba(220,55,55,0.95)' : 'rgba(150,30,30,0.85)';
      vrMenuRoundRect(ctx, box.x, box.y, box.w, box.h, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px system-ui, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Exit VR', box.x + box.w / 2, box.y + box.h / 2);

    } else if (box.id.startsWith('photo:')) {
      const photoIdx = Number(box.id.split(':')[1]);
      const isCurrent = photoIdx === currentPhotoIdx;

      if (isHov || isCurrent) {
        ctx.fillStyle = isHov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)';
        vrMenuRoundRect(ctx, box.x, box.y, box.w, box.h, 6);
        ctx.fill();
      }
      if (isCurrent) {
        ctx.fillStyle = '#4a9eff';
        ctx.fillRect(box.x + 4, box.y + 8, 3, box.h - 16);
      }
      ctx.fillStyle = isCurrent ? '#fff' : (isHov ? '#eee' : '#bbb');
      ctx.font = `${isCurrent ? 'bold ' : ''}17px system-ui, Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(photos[photoIdx]?.name ?? '', box.x + (isCurrent ? 14 : 10), box.y + box.h / 2);

    } else if (box.id === 'prev' || box.id === 'next') {
      ctx.fillStyle = isHov ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
      vrMenuRoundRect(ctx, box.x, box.y, box.w, box.h, 6);
      ctx.fill();
      ctx.fillStyle = isHov ? '#fff' : '#aaa';
      ctx.font = '15px system-ui, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(box.id === 'prev' ? '◀  Prev' : 'Next  ▶', box.x + box.w / 2, box.y + box.h / 2);
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, 90);
  ctx.lineTo(W - 32, 90);
  ctx.stroke();

  if (photos.length > 1) {
    ctx.fillStyle = '#555';
    ctx.font = '11px system-ui, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SWITCH VIEW', 32, 106);
  }

  if (vrDwellTarget && vrDwellStart > 0) {
    const box = boxes.find(b => b.id === vrDwellTarget);
    if (box) {
      const t = Math.min((performance.now() - vrDwellStart) / VR_DWELL_MS, 1);
      ctx.beginPath();
      ctx.arc(box.x + box.w / 2, box.y + box.h / 2, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  vrMenuTexture.needsUpdate = true;
}

function createVRMenu() {
  vrMenuCanvas = document.createElement('canvas');
  vrMenuCanvas.width = VR_MENU_CANVAS_W;
  vrMenuCanvas.height = VR_MENU_CANVAS_H;
  vrMenuCtx = vrMenuCanvas.getContext('2d');

  vrMenuTexture = new THREE.CanvasTexture(vrMenuCanvas);
  vrMenuTexture.colorSpace = THREE.SRGBColorSpace;

  vrMenuMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(VR_MENU_WIDTH, VR_MENU_HEIGHT),
    new THREE.MeshBasicMaterial({ map: vrMenuTexture, transparent: true, depthWrite: false })
  );

  vrMenuGroup = new THREE.Group();
  vrMenuGroup.add(vrMenuMesh);
  vrMenuGroup.visible = false;
  scene.add(vrMenuGroup);

  vrGazeCursor = new THREE.Mesh(
    new THREE.CircleGeometry(0.01, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.75, transparent: true, depthTest: false })
  );
  vrGazeCursor.visible = false;
  scene.add(vrGazeCursor);

  drawVRMenu();
}

function positionVRMenuInView() {
  if (!vrMenuGroup) return;
  const xrCamera = renderer.xr.getCamera();
  xrCamera.getWorldPosition(_vrRayOrigin);
  _vrRayDir.set(0, 0, -1).applyQuaternion(xrCamera.quaternion);
  _vrRayDir.y = Math.min(_vrRayDir.y, 0.1);
  _vrRayDir.normalize();
  vrMenuGroup.position.copy(_vrRayOrigin).addScaledVector(_vrRayDir, VR_MENU_DISTANCE);
  vrMenuGroup.lookAt(_vrRayOrigin);
}

function showVRMenu() {
  if (!vrMenuGroup || vrMenuVisible) return;
  vrMenuVisible = true;
  const idx = photoSelect.value !== '' ? Number(photoSelect.value) : 0;
  vrMenuPhotoPage = Math.floor(idx / VR_MENU_PHOTOS_PER_PAGE);
  positionVRMenuInView();
  drawVRMenu();
  vrMenuGroup.visible = true;
  if (vrGazeCursor) vrGazeCursor.visible = true;
  for (const ray of xrControllerRays) ray.visible = true;
}

function hideVRMenu() {
  if (!vrMenuGroup || !vrMenuVisible) return;
  vrMenuVisible = false;
  vrMenuGroup.visible = false;
  if (vrGazeCursor) vrGazeCursor.visible = false;
  for (const ray of xrControllerRays) ray.visible = false;
  vrMenuHoveredId = null;
  vrDwellTarget = null;
  vrDwellStart = 0;
}

function hitTestVRMenu(raycaster) {
  if (!vrMenuMesh || !vrMenuVisible) return null;
  const hits = raycaster.intersectObject(vrMenuMesh);
  if (!hits.length || !hits[0].uv) return null;
  const cx = hits[0].uv.x * VR_MENU_CANVAS_W;
  const cy = (1 - hits[0].uv.y) * VR_MENU_CANVAS_H;
  for (const box of getVRMenuHitboxes()) {
    if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) return box.id;
  }
  return null;
}

function activateVRMenuItem(id) {
  if (!id) return;
  if (id === 'close') {
    hideVRMenu();
  } else if (id === 'exit') {
    setTimeout(() => { if (xrSession) xrSession.end(); }, 0);
  } else if (id === 'prev') {
    vrMenuPhotoPage = Math.max(0, vrMenuPhotoPage - 1);
    drawVRMenu();
  } else if (id === 'next') {
    vrMenuPhotoPage = Math.min(Math.ceil(photos.length / VR_MENU_PHOTOS_PER_PAGE) - 1, vrMenuPhotoPage + 1);
    drawVRMenu();
  } else if (id.startsWith('photo:')) {
    const idx = Number(id.split(':')[1]);
    if (!Number.isNaN(idx) && idx < photos.length) {
      photoSelect.value = idx;
      loadPhoto(photos[idx]);
      drawVRMenu();
    }
  }
}

function onXRControllerSelect(event) {
  const controller = event.target;
  controller.getWorldPosition(_vrRayOrigin);
  _vrRayDir.set(0, 0, -1).applyQuaternion(controller.quaternion);
  _vrRaycaster.set(_vrRayOrigin, _vrRayDir.normalize());
  const id = hitTestVRMenu(_vrRaycaster);
  if (id) {
    activateVRMenuItem(id);
  } else if (!vrMenuVisible) {
    showVRMenu();
  }
}

function onXRControllerSqueeze() {
  if (vrMenuVisible) hideVRMenu();
  else showVRMenu();
}

function setupXRControllers() {
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('selectstart', onXRControllerSelect);
    controller.addEventListener('squeezestart', onXRControllerSqueeze);
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.4, transparent: true, depthTest: false })
    );
    ray.visible = false;
    controller.add(ray);
    scene.add(controller);
    xrControllers.push(controller);
    xrControllerRays.push(ray);
  }
}

function teardownXRControllers() {
  for (let i = 0; i < xrControllers.length; i++) {
    xrControllers[i].removeEventListener('selectstart', onXRControllerSelect);
    xrControllers[i].removeEventListener('squeezestart', onXRControllerSqueeze);
    if (xrControllerRays[i]) xrControllers[i].remove(xrControllerRays[i]);
    scene.remove(xrControllers[i]);
  }
  xrControllers.length = 0;
  xrControllerRays.length = 0;
}

function updateVRMenu() {
  if (!renderer.xr.isPresenting) return;

  const xrCamera = renderer.xr.getCamera();

  if (vrGazeCursor && vrGazeCursor.visible) {
    xrCamera.getWorldPosition(_vrRayOrigin);
    _vrRayDir.set(0, 0, -1).applyQuaternion(xrCamera.quaternion);
    vrGazeCursor.position.copy(_vrRayOrigin).addScaledVector(_vrRayDir, VR_MENU_DISTANCE - 0.01);
    vrGazeCursor.lookAt(_vrRayOrigin);
  }

  if (!vrMenuVisible) return;

  let hoveredId = null;
  for (const controller of xrControllers) {
    if (hoveredId) break;
    controller.getWorldPosition(_vrRayOrigin);
    _vrRayDir.set(0, 0, -1).applyQuaternion(controller.quaternion);
    _vrRaycaster.set(_vrRayOrigin, _vrRayDir.normalize());
    hoveredId = hitTestVRMenu(_vrRaycaster);
  }

  if (!hoveredId) {
    xrCamera.getWorldPosition(_vrRayOrigin);
    _vrRayDir.set(0, 0, -1).applyQuaternion(xrCamera.quaternion);
    _vrRaycaster.set(_vrRayOrigin, _vrRayDir.normalize());
    hoveredId = hitTestVRMenu(_vrRaycaster);
  }

  const now = performance.now();
  if (hoveredId !== vrDwellTarget) {
    vrDwellTarget = hoveredId;
    vrDwellStart = hoveredId ? now : 0;
  } else if (hoveredId && vrDwellStart > 0 && now - vrDwellStart >= VR_DWELL_MS) {
    vrDwellStart = 0;
    vrDwellTarget = null;
    activateVRMenuItem(hoveredId);
    hoveredId = null;
  }

  const needsRedraw = hoveredId !== vrMenuHoveredId || (vrDwellTarget && vrDwellStart > 0);
  if (needsRedraw) {
    vrMenuHoveredId = hoveredId;
    drawVRMenu();
  }
}

// ── WebXR ─────────────────────────────────────────────────────
let xrSession = null;
let vrButton = null;
let preVrFov = INITIAL_FOV;
let preVrYaw = 0;
let preVrPitch = 0;

async function initXR() {
  if (!('xr' in navigator)) return;

  const supported = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!supported) return;

  vrButton = document.createElement('button');
  vrButton.className = 'vr-button';
  vrButton.textContent = 'Enter VR';
  vrButton.addEventListener('click', toggleVR);
  vrButtonContainer.appendChild(vrButton);
}

async function toggleVR() {
  if (xrSession) {
    xrSession.end();
    return;
  }

  disableMotionLook();
  preVrFov = camera.fov;
  preVrYaw = yaw;
  preVrPitch = pitch;

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });

    await renderer.xr.setSession(session);

    // Register AFTER setSession so Three.js's own 'end' handler runs first,
    // setting isPresenting=false before our cleanup code reads it.
    session.addEventListener('end', () => {
      xrSession = null;
      teardownXRControllers();
      hideVRMenu();
      yaw = preVrYaw;
      pitch = preVrPitch;
      camera.position.set(0, 0, 0);
      camera.scale.set(1, 1, 1);
      camera.zoom = 1;
      applyRotation();
      camera.updateMatrixWorld(true);
      setCameraFov(preVrFov);
      vrButton.textContent = 'Enter VR';
      vrButton.classList.remove('vr-button-active');
      updateMotionButton();
      updateFullscreenButton();
      syncFullscreenUiState();
      onResize();
    });
    xrSession = session;
    setupXRControllers();
    showVRMenu();
    vrButton.textContent = 'Exit VR';
    vrButton.classList.add('vr-button-active');
    updateMotionButton();
    updateFullscreenButton();
    syncFullscreenUiState();
    hideHint();
  } catch (e) {
    console.error('Failed to start VR session:', e);
  }
}

// ── Render loop ───────────────────────────────────────────────
// setAnimationLoop is XR-compatible: Three.js switches to XR frame
// delivery automatically when a session is active.
renderer.setAnimationLoop(() => {
  updateVRMenu();
  renderer.render(scene, camera);
});

// ── Init ──────────────────────────────────────────────────────
let photos = [];

async function init() {
  const appConfig = await loadAppConfig();
  applyAppConfig(appConfig);

  onResize();
  initFullscreen();
  initMotionLook();
  initXR();

  photos = await discoverPhotos(appConfig.textureMediaPaths);

  if (photos.length === 0) {
    loadStatus.textContent = 'No images found in configured texture media paths';
    return;
  }

  photos.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    photoSelect.appendChild(opt);
  });

  photoSelect.addEventListener('change', () => {
    loadPhoto(photos[Number(photoSelect.value)]);
    hideHint();
  });

  createVRMenu();
  loadPhoto(photos[0]);
}

init();
