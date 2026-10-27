# Interface notes

## Reference and scope

The 0.9 website uses [Lusion](https://lusion.co/) as a visual and interaction reference: a large real-time scene, a small fixed header, large regular-weight type, a video surface that changes with scroll, and separate navigation cards. The reference was inspected in the browser and its public animation structure was studied on 2026-10-27.

The geometry, physics, shader and page controllers here are project code. Lusion's source bundle, models, photographs, videos, logos and proprietary fonts are not redistributed. Earlier [Superlist](https://www.superlist.com/) studies informed the use of actual application recordings; those recordings remain in this version.

[Source and interaction study](reference-study.md) records the inspected values and implementation choices.

## Type and layout

The tour uses the existing bundled Inter Latin subset through the Tour Grotesk alias, with regular-weight large headings. Chinese uses the unchanged MiSans Regular file. The review workspace continues to use Geist and MiSans. Font synthesis is disabled and no font service is contacted. See [font maintenance](fonts.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

The website places its description above a wide 3D viewport. Below it are the main recorded workflow, two feature previews and installation instructions. A small white-card menu holds the section links and language switch. Repeated dashboard cards and the large overlaid transport strip have been removed from the presentation.

The review workspace keeps its library, waveform, review form, light/dark appearance and direct import actions. This release does not change the review data model.

## Scene and input

Three.js 0.180.0 is bundled locally. Hollow connectors are built from a smooth union of capped tubes with bores through each axis. The scene uses studio lighting, three material groups and instanced meshes; no downloaded model or reference-site texture is required.

The small scene simulation handles pointer repulsion, dragging, gentle idle rotation and a coordinated impulse when the palette changes. It uses bounded time steps and velocities, with deterministic initial placement. Pointer input is used directly; animation is not a prerecorded hero video. The motion button can pause the scene, and work stops when it is outside the viewport or the document is hidden.

The sample button plays a twelve-second generated piano phrase through Web Audio after a click. Its measured level feeds a small scale response in the scene. It is separate from the audio collection and does not create a review record.

## Scroll, menu and video

Page scrolling remains native. Section transforms follow a damped progress value rather than replacing the page's scroll position. The blue ribbon and video surface respond to that progress.

On wider screens, an original 32 × 32 plane shader expands the reel from a small rectangle into a wide frame. Diagonally offset vertex phases give the middle of the transition a slight curl; both endpoints are rectangular. The image changes from cobalt-tinted to full color. The DOM poster remains until a decoded frame renders successfully.

The menu's cards enter with staggered movement and rotation. Opening and closing can be reversed. Keyboard focus, Escape and the menu button remain available during transitions.

The main preview loops silently while visible. Feature previews play on hover or focus, or while sufficiently visible on a coarse-pointer device. Clicking a recording opens the fullscreen viewer with ordinary video playback controls. Closing it stops that player and returns focus. Inline playback pauses while the menu or viewer is open.

## Motion preferences and fallback

Reduced-motion and compact layouts bypass the reel warp. Decorative movement can stop while playback remains available. Data-saving preferences keep recordings at their posters until explicit play. Sound never starts automatically.

If the scene cannot render, the page uses its own static scene poster. A failed reel surface falls back to the ordinary video element. These paths keep navigation, installation links and recordings usable.

## Review behaviour

Time notes can be added, edited, moved and removed. Invalid times keep the editor open. Cancelling restores the original note. Save includes a note being composed.

Search combines filenames, IDs, review notes and time notes. A clip outside the filter keeps its draft. Save & continue follows the current queue and skips reviewed clips. Listening memory stays separate from review data, is scoped to the workspace and audio version, and resumes paused.

## Maintenance

The scene bundle's entry, lock file and digest are in scripts/scene-build. [Media notes](showcase-media.md) document the retained recordings and generated assets. [Verification](verification.md) records actual automated, browser, installation and compatibility checks without making a cross-device frame-rate claim.

![Workspace](screenshot-zh-CN.png)

![Website](screenshot-tour.png)
