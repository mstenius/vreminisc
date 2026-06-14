// vreminisc — version badge
// Fetches version.json and renders it in the header. Official releases get a
// clean badge, untagged dev builds are clearly marked.

const VERSION_PATH = './version.json';

fetch(VERSION_PATH)
  .then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  })
  .then((data) => {
    const versionEl = document.getElementById('version');
    if (!versionEl) {
      return;
    }

    if (data.isOfficialRelease) {
      versionEl.textContent = `v${data.lastStableVersion}`;
    } else {
      versionEl.textContent = `v${data.lastStableVersion}-dev`;
    }

    versionEl.hidden = false;
  })
  .catch((err) => {
    console.warn('Could not load version.json:', err);
  });
