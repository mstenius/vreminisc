// photo-loader.js — Photo discovery + sphere texture loading for VReminisc
// Discovers photos (manifest, falling back to directory listing) via config.js,
// and swaps the sphere material's equirectangular texture, disposing the previous.
import * as THREE from 'three';
import { discoverPhotos } from './config.js';

/**
 * createPhotoLoader(sphereMat, { onLoadStart, onLoadEnd, onError })
 *
 * @param {THREE.Material} sphereMat   - The inverted-sphere material whose `.map` is swapped
 * @param {Function}       onLoadStart - Called with (name) when a photo begins loading
 * @param {Function}       onLoadEnd   - Called with (name) when a photo finishes loading
 * @param {Function}       onError     - Called with (name) when a photo fails to load
 *
 * @returns {{ loadPhotos(textureMediaPaths), loadPhoto(photo), getPhotos(), dispose() }}
 */
export function createPhotoLoader(sphereMat, { onLoadStart, onLoadEnd, onError } = {}) {
  const texLoader = new THREE.TextureLoader();
  let photos = [];

  /** Discover photos across the configured media paths. Returns Promise<Photo[]>. */
  async function loadPhotos(textureMediaPaths) {
    photos = await discoverPhotos(textureMediaPaths);
    return photos;
  }

  function getPhotos() {
    return photos;
  }

  /** Load a photo's texture onto the sphere, disposing the previous one. */
  function loadPhoto(photo) {
    if (!photo) return;
    const { name, url } = photo;
    if (onLoadStart) onLoadStart(name);

    texLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const prev = sphereMat.map;
        sphereMat.map = tex;
        sphereMat.needsUpdate = true;
        if (prev) prev.dispose();
        if (onLoadEnd) onLoadEnd(name);
      },
      undefined,
      () => {
        if (onError) onError(name);
      }
    );
  }

  function dispose() {
    if (sphereMat.map) {
      sphereMat.map.dispose();
      sphereMat.map = null;
    }
  }

  return { loadPhotos, loadPhoto, getPhotos, dispose };
}
