// Serve MediaPipe's wasm from our own origin: no CDN dependency, cached by the service worker after first use.
import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('public/mediapipe/wasm', { recursive: true })
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'])
  cpSync(`node_modules/@mediapipe/tasks-vision/wasm/${f}`, `public/mediapipe/wasm/${f}`)
