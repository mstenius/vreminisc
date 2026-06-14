// fullscreen-manager.js — Fullscreen toggle + auto-hide UI for VReminisc
import { IS_SAFARI, IS_IOS, FULLSCREEN_UI_HIDE_DELAY, FULLSCREEN_UI_REVEAL_ZONE } from './config.js';

export function createFullscreenManager({ fullscreenButton, header, isVRActive, onStatusMessage, onResize, onInteract } = {}) {
  let fullscreenUiHideTimeout = 0;
  const fullscreenRoot = document.documentElement;

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

  function isFullscreen() {
    return Boolean(getFullscreenElement());
  }

  function isFullscreenBrowserMode() {
    return Boolean(getFullscreenElement()) && !isVRActive();
  }

  function updateButton() {
    if (!fullscreenButton) return;
    const active = Boolean(getFullscreenElement());
    fullscreenButton.textContent = active ? 'Exit Fullscreen' : 'Fullscreen';
    fullscreenButton.ariaPressed = active ? 'true' : 'false';
    fullscreenButton.disabled = isVRActive();
  }

  function clearHideTimeout() {
    if (!fullscreenUiHideTimeout) return;
    window.clearTimeout(fullscreenUiHideTimeout);
    fullscreenUiHideTimeout = 0;
  }

  function showUi() {
    if (!header) return;
    header.classList.remove('hidden-in-fullscreen');
  }

  function hideUi() {
    if (!header || !isFullscreenBrowserMode()) return;
    header.classList.add('hidden-in-fullscreen');
  }

  function scheduleUiHide() {
    clearHideTimeout();
    if (!isFullscreenBrowserMode()) {
      showUi();
      return;
    }
    fullscreenUiHideTimeout = window.setTimeout(() => {
      fullscreenUiHideTimeout = 0;
      hideUi();
    }, FULLSCREEN_UI_HIDE_DELAY);
  }

  function syncUiState() {
    const fullscreenActive = isFullscreenBrowserMode();
    document.body.classList.toggle('fullscreen-active', fullscreenActive);
    if (!fullscreenActive) {
      clearHideTimeout();
      showUi();
      return;
    }
    showUi();
    scheduleUiHide();
  }

  // Update button + sync UI classes — call from XR session start/end
  function sync() {
    updateButton();
    syncUiState();
  }

  async function toggle() {
    if (isVRActive()) return;
    if (!supportsFullscreen()) {
      if (onStatusMessage) onStatusMessage(
        IS_SAFARI && IS_IOS
          ? 'Fullscreen is limited in iPhone Safari'
          : 'Fullscreen is not supported in this browser',
        3600
      );
      return;
    }
    if (onInteract) onInteract();
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

  function handleFullscreenChange() {
    sync();
    if (onResize) onResize();
    const tag = document.activeElement?.tagName.toLowerCase();
    if (tag === 'button' || tag === 'input' || tag === 'select') {
      document.activeElement.blur();
    }
  }

  function handlePointerMove(e) {
    if (!isFullscreenBrowserMode()) return;
    if (e.clientY > FULLSCREEN_UI_REVEAL_ZONE && !header?.matches(':hover')) return;
    showUi();
    scheduleUiHide();
  }

  function handleHeaderPointerEnter() {
    if (!isFullscreenBrowserMode()) return;
    showUi();
    clearHideTimeout();
  }

  function handleHeaderPointerLeave() {
    scheduleUiHide();
  }

  function init() {
    if (!fullscreenButton || !supportsFullscreen()) return;
    fullscreenButton.hidden = false;
    fullscreenButton.addEventListener('click', toggle);
    updateButton();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('pointermove', handlePointerMove);
    if (header) {
      header.addEventListener('pointerenter', handleHeaderPointerEnter);
      header.addEventListener('pointerleave', handleHeaderPointerLeave);
    }
  }

  function dispose() {
    clearHideTimeout();
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('pointermove', handlePointerMove);
    if (header) {
      header.removeEventListener('pointerenter', handleHeaderPointerEnter);
      header.removeEventListener('pointerleave', handleHeaderPointerLeave);
    }
    if (fullscreenButton) fullscreenButton.removeEventListener('click', toggle);
  }

  return { init, isFullscreen, sync, dispose };
}
