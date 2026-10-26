# Counting, precision, and technical flags

Audio Review Desk reports separate quantities so a successful decode never becomes a fabricated listening approval.

## Duration totals

- **Raw seconds:** decoded duration summed over all readable files, including copies.
- **Unique PCM seconds:** one duration for each distinct normalized PCM hash. This is whole-file exact deduplication at the comparison precision below.
- **Candidate seconds:** union of eligible clip intervals per source ID, excluding reviews marked `fix` or `exclude`.
- **Human-approved seconds:** the same union restricted to reviews explicitly marked `pass`.

For a recording with clips `[10, 12]` and `[11, 13]`, both candidate intervals contribute `[10, 13]`, or three seconds. A saved suggested trim replaces the clip's counted interval with the corresponding subset, but never edits the audio.

Folder imports default to a source ID derived from PCM, so exact file copies share a timeline. Manifest source IDs are authoritative user metadata: different IDs are not automatically treated as the same recording. The separate unique-PCM total can therefore differ from the candidate timeline total. The tool does not infer performance identity, align unrelated encodings, or deduplicate near-matches.

An item with `eligible=false` can be listened to and reviewed, but never adds candidate or approved seconds. An unreadable item cannot be approved.

## PCM comparison

The hash includes sample rate, channel count, and interleaved samples decoded to little-endian signed PCM32. Integer PCM8/16/24/32 WAV is mapped by exact integer shifts; sample rate and channels are unchanged. Container tags are excluded. Optional FFmpeg inputs are converted to this same PCM32 representation, without resampling or downmixing.

Floating-point inputs and some compressed formats are quantized to signed PCM32 by FFmpeg. Differences smaller than this precision may therefore compare equal. The hash establishes equality of this decoded representation, not bit-identical source files or proof of lossless provenance. For scientific workflows needing float-bit identity, retain the separate original-file SHA-256 and do not rely on PCM32 deduplication alone.

## Flags and measurements

- `silence_or_very_quiet`: whole-clip RMS is at or below -60 dBFS.
- `near_full_scale`: at least one decoded sample has magnitude at or above 0.999 full scale. This is not a measurement of audible distortion or true intersample peak.
- `multichannel`: more than two channels.
- `decode_error`: the file is missing, unreadable, empty, truncated, changed during analysis, or failed full decode.

Quiet-edge durations use a per-frame peak threshold of 0.001 full scale. The waveform is a reduced peak display, not a spectral analysis or editable cut boundary.

A/B previews are PCM16 listening copies. Where both clips have RMS above -120 dBFS, constant attenuation lowers the louder RMS to the quieter RMS. A common headroom attenuation keeps sample peaks at or below 0.98. A silent reference does not mute the audible signal. RMS matching is not LUFS matching, and previews are not exported training material.
