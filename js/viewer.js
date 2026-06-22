// vreminisc — 360° equirectangular photo viewer (Three.js / WebXR)

import * as THREE from 'three';
import { createMotionLook } from './motion-look.js';
import { createCameraController } from './camera-controller.js';
import { createPhotoLoader } from './photo-loader.js';
import { createVRMenu } from './vr-menu.js';
import { createFullscreenManager } from './fullscreen-manager.js';
import { createUIManager } from './browser-ui-manager.js';
import { createXRManager } from './xr-manager.js';

import {
  INITIAL_FOV,
  loadAppConfig,
  applyAppConfig,
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

const camera = new THREE.PerspectiveCamera(INITIAL_FOV, canvas.clientWidth / canvas.clientHeight, 0.1, 1100);

// ── Photo sphere ──────────────────────────────────────────────
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

// ── UI Manager ────────────────────────────────────────────────
const uiManager = createUIManager({
  photoSelect,
  loadStatus,
  hint,
  motionButton,
  onPhotoSelect: (idx) => selectPhoto(idx),
  onResize,
});

// ── Camera controller (pointer / touch / keyboard look + zoom) ─
const cameraCtrl = createCameraController(canvas, camera, {
  isVRActive: () => xrManager.isPresenting(),
  isMotionActive: () => motionLook.isActive(),
  onInteract: () => uiManager.hideHint(),
});

// ── Motion look ───────────────────────────────────────────────
const motionLook = createMotionLook({
  motionButton,
  onMotionSample(nextYaw, nextPitch) {
    cameraCtrl.setYawPitch(nextYaw, nextPitch);
  },
  onStatusMessage: uiManager.setStatus,
  onActivate: () => uiManager.hideHint(),
  isVRActive: () => xrManager.isPresenting(),
});

// ── Photo loader ──────────────────────────────────────────────
const photoLoader = createPhotoLoader(sphereMat, {
  onLoadStart: (name) => uiManager.setStatus(`Loading ${name}…`, 0),
  onLoadEnd: () => {
    cameraCtrl.setFov(INITIAL_FOV);
    uiManager.setStatus('', 0);
  },
  onError: (name) => uiManager.setStatus(`Failed to load ${name}`, 0),
});

// ── Resize ────────────────────────────────────────────────────
function onResize() {
  if (xrManager.isPresenting()) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── Fullscreen ────────────────────────────────────────────────
const fullscreenManager = createFullscreenManager({
  fullscreenButton,
  header,
  isVRActive: () => xrManager.isPresenting(),
  onStatusMessage: uiManager.setStatus,
  onResize,
  onInteract: () => uiManager.hideHint(),
});

// ── VR Menu ───────────────────────────────────────────────────
const vrMenu = createVRMenu(scene, renderer, {
  onSelectPhoto: (idx) => selectPhoto(idx),
  onExitVR: () => xrManager.endSession(),
  getPhotos: () => photos,
  getCurrentPhotoIndex: () => photoSelect.value !== '' ? Number(photoSelect.value) : 0,
});

// ── WebXR ─────────────────────────────────────────────────────
let preVrFov = INITIAL_FOV;
let preVrYaw = 0;
let preVrPitch = 0;

const xrManager = createXRManager(renderer, {
  buttonContainer: vrButtonContainer,
  onSessionStart() {
    motionLook.disable();
    preVrFov = cameraCtrl.getFov();
    preVrYaw = cameraCtrl.getYaw();
    preVrPitch = cameraCtrl.getPitch();
    vrMenu.setupControllers();
    vrMenu.show();
    fullscreenManager.sync();
    uiManager.hideHint();
  },
  onSessionEnd() {
    vrMenu.teardownControllers();
    vrMenu.hide();
    camera.position.set(0, 0, 0);
    camera.scale.set(1, 1, 1);
    camera.zoom = 1;
    cameraCtrl.setYawPitch(preVrYaw, preVrPitch);
    camera.updateMatrixWorld(true);
    cameraCtrl.setFov(preVrFov);
    motionLook.disable();
    fullscreenManager.sync();
    onResize();
    // Canvas layout may not have fully settled synchronously after XR session
    // end (e.g. if the browser fires fullscreenchange in a subsequent task).
    // A deferred resize ensures the correct aspect ratio is applied.
    requestAnimationFrame(onResize);
  },
});

// ── Render loop ───────────────────────────────────────────────
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
  uiManager.init();
  fullscreenManager.init();
  motionLook.init();
  xrManager.init();

  photos = await photoLoader.loadPhotos(appConfig.textureMediaPaths);

  if (photos.length === 0) {
    uiManager.setStatus('No images found in configured texture media paths', 0);
    return;
  }

  uiManager.setPhotos(photos);

  const paramFilename = new URLSearchParams(location.search).get('photo');
  const initialIndex = paramFilename
    ? Math.max(0, photos.findIndex(p => photoFilename(p) === paramFilename))
    : 0;

  vrMenu.init();
  selectPhoto(initialIndex);
}

init();
