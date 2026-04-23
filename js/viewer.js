// vreminisc — A 360 degree equirectangular photo viewer
// Uses Three.js for WebXR.
// Place user inside a textured sphere.
// VR mode hands tracking to the headset, desktop/mobile mode uses drag-to-look and zoom.

import * as THREE from 'three';

// ── Photo discovery ───────────────────────────────────────────
// Prefer a static manifest so photo discovery is independent of the HTTP server.
// Fall back to HTML directory listings when available for convenience.
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
const TEXTURES_DIR = 'media/textures/';
const PHOTOS_MANIFEST = `${TEXTURES_DIR}photos.json`;
const texturesBaseUrl = new URL(TEXTURES_DIR, window.location.href);

function humanizePhotoName(filename) {
  return decodeURIComponent(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ');
}

function toPhoto(entry, title = '') {
  if (typeof entry !== 'string' || !IMAGE_RE.test(entry)) return null;

  const url = new URL(entry, texturesBaseUrl);
  const filename = url.pathname.split('/').pop();
  if (!filename) return null;

  return {
    name: title || humanizePhotoName(filename),
    url: url.href,
  };
}

function normalizeManifestEntry(entry) {
  if (typeof entry === 'string') {
    return toPhoto(entry);
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
  return toPhoto(file, title);
}

async function discoverPhotosFromManifest() {
  const res = await fetch(PHOTOS_MANIFEST, { cache: 'no-store' });
  if (!res.ok) return [];

  const manifest = await res.json().catch(() => null);
  if (!Array.isArray(manifest)) return [];

  return manifest
    .map(normalizeManifestEntry)
    .filter(Boolean);
}

async function discoverPhotosFromDirectoryListing() {
  const res = await fetch(TEXTURES_DIR);
  if (!res.ok) return [];

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => a.getAttribute('href'))
    .map((href) => href ? toPhoto(href) : null)
    .filter(Boolean);
}

async function discoverPhotos() {
  const manifestPhotos = await discoverPhotosFromManifest();
  if (manifestPhotos.length > 0) return manifestPhotos;
  return discoverPhotosFromDirectoryListing();
}

// ── DOM refs ──────────────────────────────────────────────────
const canvas = document.getElementById('glcanvas');
const photoSelect = document.getElementById('photoSelect');
const vrButtonContainer = document.getElementById('vrButtonContainer');
const loadStatus = document.getElementById('loadStatus');
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
const camera = new THREE.PerspectiveCamera(INITIAL_FOV, canvas.clientWidth / canvas.clientHeight, 0.1, 1100);

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
const activePointers = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setCameraFov(nextFov) {
  camera.fov = clamp(nextFov, MIN_FOV, MAX_FOV);
  camera.updateProjectionMatrix();
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
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
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

  if (primaryPointerId !== e.pointerId) return;

  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  prevX = e.clientX;
  prevY = e.clientY;
  yaw   -= dx * 0.003;
  pitch -= dy * 0.003;
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

// ── WebXR ─────────────────────────────────────────────────────
let xrSession = null;
let vrButton = null;

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

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });

    session.addEventListener('end', () => {
      xrSession = null;
      renderer.xr.setSession(null);
      vrButton.textContent = 'Enter VR';
      vrButton.classList.remove('vr-button-active');
      onResize();
    });

    await renderer.xr.setSession(session);
    xrSession = session;
    vrButton.textContent = 'Exit VR';
    vrButton.classList.add('vr-button-active');
    hideHint();
  } catch (e) {
    console.error('Failed to start VR session:', e);
  }
}

// ── Render loop ───────────────────────────────────────────────
// setAnimationLoop is XR-compatible: Three.js switches to XR frame
// delivery automatically when a session is active.
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

// ── Init ──────────────────────────────────────────────────────
let photos = [];

async function init() {
  onResize();
  initXR();

  photos = await discoverPhotos();

  if (photos.length === 0) {
    loadStatus.textContent = 'No images found in media/textures/';
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

  loadPhoto(photos[0]);
}

init();
