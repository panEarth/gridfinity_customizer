# gridfinity_customizer

Parametric [Gridfinity](https://gridfinity.xyz/) modelling in the browser. Configure a bin or baseplate, preview it in 3D and download an STL. Nothing to install, and everything runs locally in your browser.

**Live app:** https://panearth.github.io/gridfinity_customizer/

## Features

**Bins**
- Size in Gridfinity units: width and depth (42 mm), height (7 mm)
- Dividers across width and depth
- Front scoop and label shelf
- Stacking lip, magnet holes (6.5 × 2.4 mm), M3 screw holes
- Adjustable wall, floor and divider thickness

**Baseplates**
- Any size in grid units
- Open frame, solid bottom, or magnet holes

**Export**
- Download STL or 3MF
- **Print with EasyPrint**: uploads a 3MF to Prusa EasyPrint and opens it in a new tab
- **Open in PrusaSlicer** (desktop only): opens the same upload in the PrusaSlicer app

Settings are kept in the URL, so you can share or bookmark a configuration with **Copy link**.

## How it works

- `gridfinity.js` builds the geometry with [Manifold](https://github.com/elalish/manifold) (WASM CSG) and writes binary STL.
- `threemf.js` writes 3MF packages without any library.
- `slicer.js` uploads the model to the [EasyPrint import API](https://slicer.printables.com/developers/import). Uploads are anonymous and the links expire after 30 minutes. The link back to the exact configuration is sent as attribution.
- `index.html` contains the UI and the three.js preview.
- It is a static site: no build step. GitHub Pages serves it from `main`.

To run it locally, serve the folder with any static server, e.g. `python3 -m http.server`, and open http://localhost:8000.

## Credits

Gridfinity is an open modular storage system designed by Zack Freedman.
