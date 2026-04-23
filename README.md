# VReminisc

By Mårten Stenius - marten@stenius.org

A minimal 360° equirectangular photo viewer for the web, with WebXR VR headset support.

Serve it statically and open in a browser on your PC, mobile or VR helmet.

Use it to step inside your 360° memories. Indulge in the reminiscing of past moments.

## Running

```sh
cd vreminisc
python3 -m http.server
# open http://localhost:8000
```

Or with your own static HTTP server of choice.

## Adding photos

Drop any equirectangular image (JPEG, PNG, WebP, AVIF) into `media/textures/`, then add it to `media/textures/photos.json` with a `title`. It will appear in the photo selector on next page load.

The recommended format is a JSON array of objects:

```json
[
  { "file": "forest-sphere1.jpg", "title": "Forest 1" },
  { "file": "forest-sphere2.jpg", "title": "Forest 2" }
]
```

The viewer also accepts `name` instead of `title`, and plain filename strings:

```json
[
  "forest-sphere.jpg",
  { "file": "forest-sphere.jpg", "name": "Forest" }
]
```

If the manifest is missing, the viewer falls back to parsing a server directory listing when one is available. This, in turn, depends on the web server 
configuration.

## Controls

| Input | Action |
|-------|--------|
| Click + drag | Look around |
| Touch + drag | Look around (mobile) |
| Scroll wheel | Zoom in/out |
| Pinch | Zoom in/out (mobile) |
| Fullscreen button | Enter/exit fullscreen |
| Esc | Exit fullscreen (when in fullscreen) |
| Enter VR button | Start immersive VR session (requires WebXR-capable browser/headset) |

## Structure

```
index.html
css/style.css
js/
  viewer.js                   — scene, XR session, photo loading
  vendor/three/three.module.js — Three.js r170 (vendored)
media/textures/               — equirectangular photos
  photos.json
  photo1.jpg
  ...
```

## Caveats

- WebXR in a VR browser (such as the one in a Quest) usually requires HTTPS. Serving over HTTP usually fails to load at all in such cases.

- Some browsers do not cope well with large textures, in particular on mobile. This usually results in a white screen.

## License

MIT

## Third-party modules

Uses [Three.js](https://threejs.org/).
