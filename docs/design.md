# Workbench design notes

The 0.3 interface is a local audio workspace: library on the left, listening in the centre, decisions on the right. The default is a warm, light surface with a single blue accent. A dark appearance and a listening-only view are available from the toolbar.

## References

| Reference | What informed this design |
| --- | --- |
| [Lusion](https://lusion.co/) — [2023 Awwwards entry](https://www.awwwards.com/sites/lusion-v3), [2024 Webby record](https://winners.webbyawards.com/2024/websites-and-mobile-sites/mobile-specific-features-design/best-mobile-visual-design-aesthetic-mobile-features/281405/lusion) | Clear type hierarchy and continuity between states. Its current site was viewed during development; its 3D scenes and scrolling effects are not part of this workbench. |
| [The Brand Identity](https://www.awwwards.com/sites/the-brand-identity) — 2021 Honorable Mention | The award entry's restrained black, grey and white palette informed the use of typography and spacing to organise content. |
| [Opal Tadpole award listing](https://www.awwwards.com/websites/nominees/?page=164) | A historical product-design reference. The live product URL now redirects to Opal's changed site, so it was not treated as evidence of the original awarded interface. |
| [Apple: Motion](https://developer.apple.com/design/human-interface-guidelines/motion) and [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | Immediate feedback, readable hierarchy, interruptible state changes and reduced-motion support. |

These are references for design decisions. No third-party site artwork, code, screenshots or logos are distributed with the application. The project has not received these awards.

## Typography

Inter handles Latin text; Noto Sans SC handles common Chinese characters. Both are bundled, so there is no font CDN dependency. Form controls explicitly inherit the same font stack. File names use the system sans-serif fallback only for characters outside the bundled subset. Font credits and licences are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Motion

- The A/B selection uses a critically damped spring, retaining position and velocity when retargeted. The exact time step is tested at 60 and 120 Hz; this is an algorithm check, not a device frame-rate claim.
- Dialogs enter in 240 ms and leave in 130 ms. Menus and small feedback surfaces enter in 170 ms. Mid-transition changes begin from the current presentation.
- Playback time comes from the audio element. Only the playhead transform changes every frame; waveform bars repaint for new audio, range edits or resize. Seeking follows input directly.
- Keyboard navigation takes the immediate path. Reduced motion removes movement and springs. Reduced transparency and increased contrast have their own styles.

## Copy

The main screen names actions and shows their results. Playback matching, file preservation and version behaviour are explained in Help or the import dialog, close to the relevant action. Technical caveats do not occupy the listening workspace.

## Frontend boundaries

`workbench.js` coordinates catalog and review state. `copy.js` holds both languages, `transport.js` owns playback controls, `waveform.js` owns drawing, and `motion.js` owns motion behaviour. The UI uses platform APIs and has no JavaScript runtime dependencies or build step.
