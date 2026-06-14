// ui-manager.js — Photo select, status messages, hint overlay, resize binding
import {
  STATUS_MESSAGE_DURATION,
  MOTION_BUTTON_LABEL,
  MOTION_BUTTON_ACTIVE_LABEL,
} from './config.js';

export function createUIManager({ photoSelect, loadStatus, hint, motionButton, onPhotoSelect, onResize } = {}) {
  let statusMessageTimeout = 0;
  let hintHidden = false;

  function setStatus(message, duration = STATUS_MESSAGE_DURATION) {
    if (!loadStatus) return;
    if (statusMessageTimeout) {
      window.clearTimeout(statusMessageTimeout);
      statusMessageTimeout = 0;
    }
    loadStatus.textContent = message;
    if (duration <= 0) return;
    statusMessageTimeout = window.setTimeout(() => {
      statusMessageTimeout = 0;
      if (loadStatus.textContent === message) loadStatus.textContent = '';
    }, duration);
  }

  function hideHint() {
    if (hintHidden || !hint) return;
    hintHidden = true;
    hint.classList.add('hidden');
    setTimeout(() => { hint.remove(); }, 600);
  }

  function updateMotionButton(active) {
    if (!motionButton) return;
    motionButton.textContent = active ? MOTION_BUTTON_ACTIVE_LABEL : MOTION_BUTTON_LABEL;
    motionButton.ariaPressed = active ? 'true' : 'false';
    motionButton.classList.toggle('toolbar-button-active', active);
  }

  function setPhotos(photos) {
    if (!photoSelect) return;
    photos.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.name;
      photoSelect.appendChild(opt);
    });
  }

  function handlePhotoSelectChange() {
    if (onPhotoSelect) onPhotoSelect(Number(photoSelect.value));
    hideHint();
  }

  function init() {
    if (photoSelect) photoSelect.addEventListener('change', handlePhotoSelectChange);
    if (onResize) window.addEventListener('resize', onResize);
  }

  function dispose() {
    if (statusMessageTimeout) {
      window.clearTimeout(statusMessageTimeout);
      statusMessageTimeout = 0;
    }
    if (photoSelect) photoSelect.removeEventListener('change', handlePhotoSelectChange);
    if (onResize) window.removeEventListener('resize', onResize);
  }

  return { init, setPhotos, setStatus, updateMotionButton, hideHint, dispose };
}
