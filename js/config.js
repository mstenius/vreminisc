// Configuration module for VReminisc viewer

// ── Photo discovery ───────────────────────────────────────────
// Prefer a static manifest so photo discovery is independent of the HTTP server.
// Fall back to HTML directory listings when available for convenience.
export const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
export const APP_CONFIG_PATH = 'app.config.json';
export const DEFAULT_TEXTURE_MEDIA_PATHS = ['media/textures/'];
export const DEFAULT_APP_CONFIG = Object.freeze({
  pageTitle: document.title,
  textureMediaPaths: DEFAULT_TEXTURE_MEDIA_PATHS,
});

export const IS_SAFARI = /^((?!chrome|chromium|crios|edg|opr|fxios|android).)*safari/i.test(navigator.userAgent);
export const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function normalizeTextureMediaPath(path) {
  if (typeof path !== 'string') return '';

  const trimmedPath = path.trim();
  if (!trimmedPath) return '';
  return trimmedPath.endsWith('/') ? trimmedPath : `${trimmedPath}/`;
}

export function normalizeTextureMediaPaths(paths) {
  if (!Array.isArray(paths)) return DEFAULT_TEXTURE_MEDIA_PATHS;

  const normalizedPaths = [...new Set(paths.map(normalizeTextureMediaPath).filter(Boolean))];
  return normalizedPaths.length > 0 ? normalizedPaths : DEFAULT_TEXTURE_MEDIA_PATHS;
}

export function normalizeAppConfig(config) {
  return {
    pageTitle: typeof config?.pageTitle === 'string' && config.pageTitle.trim()
      ? config.pageTitle.trim()
      : DEFAULT_APP_CONFIG.pageTitle,
    textureMediaPaths: normalizeTextureMediaPaths(config?.textureMediaPaths),
  };
}

export async function loadAppConfig() {
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

export function applyAppConfig(config, { titleElement } = {}) {
  document.title = config.pageTitle;
  if (titleElement) titleElement.textContent = config.pageTitle;
}

export function getMediaBaseUrl(textureMediaPath) {
  return new URL(textureMediaPath, window.location.href);
}

export function getPhotosManifestUrl(textureMediaPath) {
  return new URL('photos.json', getMediaBaseUrl(textureMediaPath)).href;
}

export function humanizePhotoName(filename) {
  return decodeURIComponent(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ');
}

export function toPhoto(textureMediaPath, entry, title = '') {
  if (typeof entry !== 'string' || !IMAGE_RE.test(entry)) return null;

  const url = new URL(entry, getMediaBaseUrl(textureMediaPath));
  const filename = url.pathname.split('/').pop();
  if (!filename) return null;

  return {
    name: title || humanizePhotoName(filename),
    url: url.href,
  };
}

export function normalizeManifestEntry(textureMediaPath, entry) {
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

export async function discoverPhotosFromManifest(textureMediaPath) {
  const res = await fetch(getPhotosManifestUrl(textureMediaPath), { cache: 'no-store' });
  if (!res.ok) return [];

  const manifest = await res.json().catch(() => null);
  if (!Array.isArray(manifest)) return [];

  return manifest
    .map((entry) => normalizeManifestEntry(textureMediaPath, entry))
    .filter(Boolean);
}

export async function discoverPhotosFromDirectoryListing(textureMediaPath) {
  const res = await fetch(textureMediaPath);
  if (!res.ok) return [];

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => a.getAttribute('href'))
    .map((href) => href ? toPhoto(textureMediaPath, href) : null)
    .filter(Boolean);
}

export async function discoverPhotosInPath(textureMediaPath) {
  const manifestPhotos = await discoverPhotosFromManifest(textureMediaPath);
  if (manifestPhotos.length > 0) return manifestPhotos;
  return discoverPhotosFromDirectoryListing(textureMediaPath);
}

export function dedupePhotos(photos) {
  const seenUrls = new Set();

  return photos.filter((photo) => {
    if (seenUrls.has(photo.url)) return false;
    seenUrls.add(photo.url);
    return true;
  });
}

export async function discoverPhotos(textureMediaPaths) {
  const photoLists = await Promise.all(textureMediaPaths.map(discoverPhotosInPath));
  return dedupePhotos(photoLists.flat());
}

// ── Constants ──────────────────────────────────────────────────
export const INITIAL_FOV = 75;
export const MIN_FOV = 20;
export const MAX_FOV = 90;
export const WHEEL_ZOOM_SPEED = 0.05;
export const FULLSCREEN_UI_HIDE_DELAY = 1800;
export const FULLSCREEN_UI_REVEAL_ZONE = 72;
export const STATUS_MESSAGE_DURATION = 2800;
export const MAX_COMPASS_ACCURACY_DEGREES = 45;
export const MOTION_BUTTON_LABEL = 'Motion Look';
export const MOTION_BUTTON_ACTIVE_LABEL = 'Stop Motion';