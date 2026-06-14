// vreminisc — A 360 degree equirectangular photo viewer
// Uses Three.js for WebXR.
// Place user inside a textured sphere.
// VR mode hands tracking to the headset, desktop/mobile mode uses drag-to-look and zoom.

import * as THREE from 'three';
import { createMotionLook } from './motion-look.js';
import { createCameraController } from './camera-controller.js';
import { createPhotoLoader } from './photo-loader.js';
import { createVRMenu } from './vr-menu.js';
import { createFullscreenManager } from './fullscreen-manager.js';

// ── Photo discovery ───────────────────────────────────────────
// Prefer a static manifest so photo discovery is independent of the HTTP server.
// Fall back to HTML directory listings when available for convenience.
import {
  IMAGE_RE,
  APP_CONFIG_PATH,
  DEFAULT_TEXTURE_MEDIA_PATHS,
  DEFAULT_APP_CONFIG,
  normalizeTextureMediaPath,
  normalizeTextureMediaPaths,
  normalizeAppConfig,
  loadAppConfig,
  applyAppConfig,
  getMediaBaseUrl,
  getPhotosManifestUrl,
  humanizePhotoName,
  toPhoto,
  normalizeManifestEntry,
  discoverPhotosFromManifest,
  discoverPhotosFromDirectoryListing,
  discoverPhotosInPath,
  dedupePhotos,
  INITIAL_FOV,
  STATUS_MESSAGE_DURATION,
} from './config.js';

// ── DOM refs ──────────────────────────────────────────────────
const canvas = document.getElementById('glcanvas');
const header = document.querySelector('header');
const photoSelect = document.getElementById('photoSelect');
const vrButtonContainer = document.getElementById('vrButtonContainer');
const loadStatus = document.getElementById('loadStatus');
const motionButton = document.getElementById('motionButton');
const fullscreenButton = document.getElementById('fullscreenButton');
const hint = document.getElementById('hint');
const headerTitle = document.getElementById('headerTitle');

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
const camera = new THREE.PerspectiveCamera(INITIAL_FOV, canvas.clientWidth / canvas.clientHeight, 0.1, 1100);

// ── Photo sphere ──────────────────────────────────────────────
// Scale X by -1 to flip winding order so the texture renders on the
// interior surface. Radius 500 — any room-scale VR movement is negligible.
const sphereGeo = new THREE.SphereGeometry(500, 60, 40);
sphereGeo.scale(-1, 1, 1);

const sphereMat = new THREE.MeshBasicMaterial();
const sphere = new THREE.Mesh(sphereGeo, sphereMat);
scene.add(sphere);

function photoFilename(photo) {
  return photo.url.split('/').pop();
}

function setPhotoUrlParam(photo) {
  const params = new URLSearchParams(location.search);
  params.set('photo', photoFilename(photo));
  history.replaceState(null, '', `?${params}`);
}

function selectPhoto(index) {
  const photo = photos[index];
  if (!photo) return;
  photoSelect.value = index;
  photoLoader.loadPhoto(photo);
  setPhotoUrlParam(photo);
  vrMenu.draw();
}

let statusMessageTimeout = 0;

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

// ── Camera controller (pointer / touch / keyboard look + zoom) ─
const cameraCtrl = createCameraController(canvas, camera, {
  isVRActive: () => renderer.xr.isPresenting,
  isMotionActive: () => motionLook.isActive(),
  onInteract: () => hideHint(),
});

// ── Motion look ───────────────────────────────────────────────
const motionLook = createMotionLook({
  motionButton,
  onMotionSample(nextYaw, nextPitch) {
    cameraCtrl.setYawPitch(nextYaw, nextPitch);
  },
  onStatusMessage: setStatusMessage,
  onActivate: () => hideHint(),
  isVRActive: () => renderer.xr.isPresenting,
});

// ── Photo loader ──────────────────────────────────────────────
const photoLoader = createPhotoLoader(sphereMat, {
  onLoadStart: (name) => { loadStatus.textContent = `Loading ${name}…`; },
  onLoadEnd: () => {
    cameraCtrl.setFov(INITIAL_FOV);
    loadStatus.textContent = '';
  },
  onError: (name) => { loadStatus.textContent = `Failed to load ${name}`; },
});

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

// ── Fullscreen ────────────────────────────────────────────────
const fullscreenManager = createFullscreenManager({
  fullscreenButton,
  header,
  isVRActive: () => renderer.xr.isPresenting,
  onStatusMessage: setStatusMessage,
  onResize,
  onInteract: () => hideHint(),
});

// ── VR Menu ───────────────────────────────────────────────────
const vrMenu = createVRMenu(scene, renderer, {
  onSelectPhoto: (idx) => selectPhoto(idx),
  onExitVR: () => { if (xrSession) xrSession.end(); },
  getPhotos: () => photos,
  getCurrentPhotoIndex: () => photoSelect.value !== '' ? Number(photoSelect.value) : 0,
});

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

  motionLook.disable();
  preVrFov = cameraCtrl.getFov();
  preVrYaw = cameraCtrl.getYaw();
  preVrPitch = cameraCtrl.getPitch();

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });

    await renderer.xr.setSession(session);

    // Register AFTER setSession so Three.js's own 'end' handler runs first,
    // setting isPresenting=false before our cleanup code reads it.
    session.addEventListener('end', () => {
      xrSession = null;
      vrMenu.teardownControllers();
      vrMenu.hide();
      camera.position.set(0, 0, 0);
      camera.scale.set(1, 1, 1);
      camera.zoom = 1;
      cameraCtrl.setYawPitch(preVrYaw, preVrPitch);
      camera.updateMatrixWorld(true);
      cameraCtrl.setFov(preVrFov);
      vrButton.textContent = 'Enter VR';
      vrButton.classList.remove('vr-button-active');
      motionLook.disable();
      fullscreenManager.sync();
      onResize();
    });
    xrSession = session;
    vrMenu.setupControllers();
    vrMenu.show();
    vrButton.textContent = 'Exit VR';
    vrButton.classList.add('vr-button-active');
    fullscreenManager.sync();
    hideHint();
  } catch (e) {
    console.error('Failed to start VR session:', e);
  }
}

// ── Render loop ───────────────────────────────────────────────
// setAnimationLoop is XR-compatible: Three.js switches to XR frame
// delivery automatically when a session is active.
renderer.setAnimationLoop(() => {
  cameraCtrl.update();
  vrMenu.update();
  renderer.render(scene, camera);
});

// ── Init ──────────────────────────────────────────────────────
let photos = [];

async function init() {
  const appConfig = await loadAppConfig();
  applyAppConfig(appConfig, { titleElement: headerTitle });

  onResize();
  fullscreenManager.init();
  motionLook.init();
  initXR();

  photos = await photoLoader.loadPhotos(appConfig.textureMediaPaths);

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
    selectPhoto(Number(photoSelect.value));
    hideHint();
  });

  const paramFilename = new URLSearchParams(location.search).get('photo');
  const initialIndex = paramFilename
    ? Math.max(0, photos.findIndex(p => photoFilename(p) === paramFilename))
    : 0;

  vrMenu.init();
  selectPhoto(initialIndex);
}

init();
