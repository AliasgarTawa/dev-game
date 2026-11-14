# Woodland day/night bike

Generated for the giant-root passage on 2026-11-14 from the approved day and night concept images in `assets/concepts/roots-bikes/`.

## Outputs and cost

- Day: `assets/models/roots-bike/bike.glb`, 31,302 triangles, 36,974,984 bytes.
- Night: `assets/models/roots-bike-night/bike.glb`, 25,983,924 bytes.
- Day generation: Meshy 7.1, standard, 4K PBR, triangle remesh targeting 30K. Task `01a1dbcd-0c54-7024-bcd8-394fe2ee37aa`; 30 credits; service processing 156.936 seconds.
- Night retexture: Meshy 7, approved night image, original UVs retained, 4K PBR. Task `01a1dbcf-cabc-733c-8dd1-33d94cd0bb52`; 10 credits; service processing 35.812 seconds.
- Total observed spending: 40 Meshy credits. Balance 1980 → 1940. No Atlas calls.
- Settings, task responses, references and balance snapshots are alongside each model. Submission runners refuse duplicate submissions.

## Integration

Open `http://127.0.0.1:17012/dev-game/index.html?scene=roots-v1` and select Route & look → Glowing night / Day. Direct night link adds `&style=night`. Standalone model inspector: `http://127.0.0.1:17012/dev-game/bike-styles.html`.

`js/roots-bike.js` loads both GLBs, validates position and UV correspondence, then renders a single mesh with blended day/night base-color, normal, roughness and metallic textures. Positions and UVs are exactly identical in the downloaded outputs (`validation.json`). This avoids a shape pop or overlapping translucent bikes. The blend follows the environment's transition progress and reverses with the day switch. Reduced motion switches immediately. Both variants must load successfully before the environment switch proceeds. A failed switch restores the previous bike look.

Meshy 7 supplies no emission map. The browser adds modest emission only to cyan pixels in the night texture. This is a local rendering effect, not an emissive map exported in the GLB. The cockpit directional light also changes from warm to cool. Model downloads in the inspector provide both original GLBs.

The woodland camera sits farther back and slightly off centre so the rear bike panel remains visible. The existing static mascot receives separate grip anchors for this bike through optional `mountRider` parameters; the desert defaults are unchanged. This is still the provisional mascot pose, not the separate agent's requested full skeletal-rig repair. Wheels remain part of a static mesh. No motorcycle physics or splat collision was added.

## Verification

- Browser: inspected day, halfway blend and night bike renders.
- In-scene day → night transition, matching bike changes, portrait 499×769, desktop 1200×800, and reduced-motion return to day checked.
- Final browser check recorded no console/page errors (`review/browser-checks.json`).
- Shader/HTML module syntax checked; original geometry and UV arrays compared directly.
- Headless browser reported ~1.04 seconds of transition plus ~3 seconds preparing the existing splat switch. Its low frame rate is not a hardware performance claim. Live-device smoothness needs separate measurement.
- Screenshots in `review/`; source models and original desert assets preserved. Existing splat holes/speckle remain.

Official references checked before calls: https://docs.meshy.ai/en/api/image-to-3d , https://docs.meshy.ai/en/api/retexture , https://docs.meshy.ai/en/api/pricing .
