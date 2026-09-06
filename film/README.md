# Lead Emergence seven-stage film

The separately preserved CREATIVE-BRIEF.md is the user's canonical design constraint. This source interpretation uses four generated, related photographic keyframes and deliberate reframing, dissolves, a continuous cyan path, and restrained later warmth. It is a silent motion-design film, not a claim of captured live-action footage. Build and produce revisit the desk and shared-work compositions; this is a first cinematic interpretation for creative review, not seven unrelated stock shots.

Canonical order: SEE REALITY → REFRAME REALITY → ALIGN WITH REALITY → BUILD CAPABILITY → PRODUCE VALUE → NEW REALITY → SEE AGAIN. The final path returns toward the lower-left handoff into the page. The wider final vantage keeps the journey open.

## Reproduce

From the repository root, run npm ci --prefix film --ignore-scripts, npm run check --prefix film, then npm run render --prefix film. Remotion 4.0.521 and its renderer/bundler are pinned in the isolated film package. The root application does not import Remotion. Set REMOTION_BROWSER_EXECUTABLE only when a different local Chrome executable is needed. Rendering uses local assets, 24 fps, H.264/yuv420p, fast-start metadata, and one-second keyframes.

Outputs: public/film/lead-emergence-hero.mp4 (1280×720, 6,187,436 bytes), lead-emergence-hero-mobile.mp4 (540×960, 4,345,220 bytes), lead-emergence-seven-stages.mp4 (1280×720 with film typography, 6,775,589 bytes). All last 42 seconds. Render evidence is in render-evidence.json. Proof frames are generated into ignored .film-local/stage-1.png through stage-7.png.

The desktop hero requests video only after intentional scrolling. A static optimized poster paints first. Small-screen and data-saving visitors retain the poster; reduced-motion visitors also receive the full ordered stage text in normal layout. The portrait render is retained as a reusable asset but does not download during the mobile page's scroll. A deliberate Watch the film action opens native, pausable playback. Escape closes the dialog. Essential page content is available immediately and independently of playback.

## Assets and reproducible prompt briefs

These are faithful asset briefs for further iteration; the generation call history is authoritative for the exact original tool payloads. All edits used the original leader-dusk image as the continuity reference. No identifiable real person was supplied as the subject.

- public/brand/leader-dusk.webp: reflective individual leader at a desk by a city window at blue hour; near-black navy atmosphere, warm desk lamp, tactile notebook, human figure on the right with quiet negative space for editorial typography on the left. No military uniform, dashboard, branding, or readable documents.
- public/brand/reframe.webp: same leader, office, dark shirt, blue-hour window and warm light. Oblique close view across the desk, a hand deliberately repositioning a plain note among other notes and indistinct ink lines. Focus on the right, negative space on the left. Perceptual reframing through a closer vantage. No readable text, logos, floating UI, particles, or generic stock-business symbols.
- public/brand/alignment.webp: same leader attentive at the desk with a colleague partly visible at the right and another softly out of focus. A small shared working moment with notes, listening and orientation around the work. Preserve the same office and light. No posed handshake, celebratory stock smiles, suits, dashboards, readable text, or military imagery.
- public/brand/new-reality.webp: same leader standing near the right-side window, viewed from behind and left, with a wider city horizon and arranged notebook/notes on the lower desk. Blue hour with a restrained warm-gold reflection. Attentive composure and a new vantage point, not victory or finality. No logos, legible text, holograms, or military imagery.

Packaging-only conversion used WebP; semantic image generation/editing used the image generation tool. The image assets and rendered films are committed with their reproducible source. Original generated PNGs remain outside the repository in the task's generated_images directory.
