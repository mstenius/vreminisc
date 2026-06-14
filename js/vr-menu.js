// vr-menu.js — Canvas-texture VR photo-selection menu for VReminisc
import * as THREE from 'three';

const VR_MENU_CANVAS_W = 600;
const VR_MENU_CANVAS_H = 560;
const VR_MENU_WIDTH = 1.4;
const VR_MENU_HEIGHT = 1.3;
const VR_MENU_DISTANCE = 1.8;
const VR_MENU_PHOTOS_PER_PAGE = 7;
const VR_DWELL_MS = 1500;

/**
 * createVRMenu(scene, renderer, { onSelectPhoto, onExitVR, getPhotos, getCurrentPhotoIndex })
 *
 * @param {THREE.Scene}    scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {Function} onSelectPhoto        - Called with (index) when a photo item is dwelled/selected
 * @param {Function} onExitVR             - Called when Exit VR item activates
 * @param {Function} getPhotos            - Returns the current Photo[] array
 * @param {Function} getCurrentPhotoIndex - Returns the current selected photo index
 *
 * @returns {{ init(), show(), hide(), isVisible(), draw(), update(), setupControllers(), teardownControllers(), dispose() }}
 */
export function createVRMenu(scene, renderer, { onSelectPhoto, onExitVR, getPhotos, getCurrentPhotoIndex } = {}) {
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

  // ── Hitbox layout ─────────────────────────────────────────────

  function getVRMenuHitboxes() {
    const W = VR_MENU_CANVAS_W;
    const H = VR_MENU_CANVAS_H;
    const photos = getPhotos();
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

  // ── Canvas drawing ────────────────────────────────────────────

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
    if (!vrMenuCtx) return;
    const photos = getPhotos();
    if (!photos.length) return;
    const ctx = vrMenuCtx;
    const W = VR_MENU_CANVAS_W;
    const H = VR_MENU_CANVAS_H;
    const hov = vrMenuHoveredId;
    const currentPhotoIdx = getCurrentPhotoIndex();

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

  // ── Positioning ───────────────────────────────────────────────

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

  // ── Hit testing ───────────────────────────────────────────────

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

  // ── Item activation ───────────────────────────────────────────

  function activateVRMenuItem(id) {
    if (!id) return;
    const photos = getPhotos();
    if (id === 'close') {
      hide();
    } else if (id === 'exit') {
      // setTimeout lets the XR frame complete before the session ends
      setTimeout(() => onExitVR(), 0);
    } else if (id === 'prev') {
      vrMenuPhotoPage = Math.max(0, vrMenuPhotoPage - 1);
      drawVRMenu();
    } else if (id === 'next') {
      vrMenuPhotoPage = Math.min(Math.ceil(photos.length / VR_MENU_PHOTOS_PER_PAGE) - 1, vrMenuPhotoPage + 1);
      drawVRMenu();
    } else if (id.startsWith('photo:')) {
      const idx = Number(id.split(':')[1]);
      if (!Number.isNaN(idx) && idx < photos.length) onSelectPhoto(idx);
    }
  }

  // ── XR controller event handlers ─────────────────────────────

  function onXRControllerSelect(event) {
    const controller = event.target;
    controller.getWorldPosition(_vrRayOrigin);
    _vrRayDir.set(0, 0, -1).applyQuaternion(controller.quaternion);
    _vrRaycaster.set(_vrRayOrigin, _vrRayDir.normalize());
    const id = hitTestVRMenu(_vrRaycaster);
    if (id) {
      activateVRMenuItem(id);
    } else if (!vrMenuVisible) {
      show();
    }
  }

  function onXRControllerSqueeze() {
    if (vrMenuVisible) hide();
    else show();
  }

  // ── Public API ────────────────────────────────────────────────

  function init() {
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

  function show() {
    if (!vrMenuGroup || vrMenuVisible) return;
    vrMenuVisible = true;
    const idx = getCurrentPhotoIndex();
    vrMenuPhotoPage = Math.floor(idx / VR_MENU_PHOTOS_PER_PAGE);
    positionVRMenuInView();
    drawVRMenu();
    vrMenuGroup.visible = true;
    if (vrGazeCursor) vrGazeCursor.visible = true;
    for (const ray of xrControllerRays) ray.visible = true;
  }

  function hide() {
    if (!vrMenuGroup || !vrMenuVisible) return;
    vrMenuVisible = false;
    vrMenuGroup.visible = false;
    if (vrGazeCursor) vrGazeCursor.visible = false;
    for (const ray of xrControllerRays) ray.visible = false;
    vrMenuHoveredId = null;
    vrDwellTarget = null;
    vrDwellStart = 0;
  }

  function isVisible() {
    return vrMenuVisible;
  }

  function draw() {
    drawVRMenu();
  }

  function update() {
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

  function setupControllers() {
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

  function teardownControllers() {
    for (let i = 0; i < xrControllers.length; i++) {
      xrControllers[i].removeEventListener('selectstart', onXRControllerSelect);
      xrControllers[i].removeEventListener('squeezestart', onXRControllerSqueeze);
      if (xrControllerRays[i]) xrControllers[i].remove(xrControllerRays[i]);
      scene.remove(xrControllers[i]);
    }
    xrControllers.length = 0;
    xrControllerRays.length = 0;
  }

  function dispose() {
    teardownControllers();
    if (vrMenuGroup) scene.remove(vrMenuGroup);
    if (vrGazeCursor) scene.remove(vrGazeCursor);
    if (vrMenuTexture) vrMenuTexture.dispose();
    if (vrMenuMesh) {
      vrMenuMesh.geometry.dispose();
      vrMenuMesh.material.dispose();
    }
  }

  return { init, show, hide, isVisible, draw, update, setupControllers, teardownControllers, dispose };
}
