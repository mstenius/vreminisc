// xr-manager.js — WebXR session lifecycle for VReminisc
export function createXRManager(renderer, { buttonContainer, onSessionStart, onSessionEnd } = {}) {
  let xrSession = null;
  let vrButton = null;

  function handleSessionEnd() {
    xrSession = null;
    vrButton.textContent = 'Enter VR';
    vrButton.classList.remove('vr-button-active');
    if (onSessionEnd) onSessionEnd();
  }

  async function toggle() {
    if (xrSession) {
      xrSession.end();
      return;
    }

    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });

      await renderer.xr.setSession(session);

      // Register AFTER setSession so Three.js's own 'end' handler runs first,
      // setting isPresenting=false before our cleanup code reads it.
      session.addEventListener('end', handleSessionEnd);

      xrSession = session;
      vrButton.textContent = 'Exit VR';
      vrButton.classList.add('vr-button-active');
      if (onSessionStart) onSessionStart();
    } catch (e) {
      console.error('Failed to start VR session:', e);
    }
  }

  function isPresenting() {
    return renderer.xr.isPresenting;
  }

  function endSession() {
    if (xrSession) xrSession.end();
  }

  async function init() {
    if (!('xr' in navigator)) return;

    const supported = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
    if (!supported) return;

    vrButton = document.createElement('button');
    vrButton.className = 'vr-button';
    vrButton.textContent = 'Enter VR';
    vrButton.addEventListener('click', toggle);
    if (buttonContainer) buttonContainer.appendChild(vrButton);
  }

  function dispose() {
    if (vrButton) {
      vrButton.removeEventListener('click', toggle);
      vrButton.remove();
      vrButton = null;
    }
  }

  return { init, isPresenting, endSession, dispose };
}
