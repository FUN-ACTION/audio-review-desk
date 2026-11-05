# Indexed audio byte advisory: deliberately narrow AAC-LC subset

`mp4_indexed_audio_bytes_unavailable` is a nonblocking observation: **Some indexed
audio bytes unavailable or container metadata inconsistent**. It does not prove
corruption, identify why bytes are unavailable, compare durations, or certify an
original recording's completeness. A successful decode is not such a certificate
either. Absence of this flag means either no observed discrepancy or unassessed.
Unsupported and malformed inputs do not receive a positive missing-byte verdict.
The older top-level extent advisory remains separate and unchanged.

## Scope and algorithm

Only a recognized initial `ftyp`, complete top-level extents, one complete `moov`,
one self-contained unencrypted `soun` track, and one supported `mp4a` sample
entry are assessed. This is a verified producer subset, **not all ISO BMFF/M4A**.

Allowed structural children are explicit: top-level `ftyp/moov/mdat/free/skip`;
`moov`: `mvhd/trak/udta`; `trak`: `tkhd/mdia/edts`; `edts`: `elst`; `mdia`:
`mdhd/hdlr/minf`; `minf`: `smhd/dinf/stbl`; `dinf`: `dref`; `stbl`:
`stsd/stts/stsc/stsz/stco/co64/sgpd/sbgp`; the sample entry allows only `esds` and
optional `btrt`. Mandatory boxes are unique. `udta` is treated as opaque user
metadata, not another location for media structure. No other unknown structural
extensions are ignored. Nested size-zero boxes are unassessed. Ordinary and
extended headers are supported, as is a final size-zero `mdat` consuming EOF.
Payloads of all `mdat` boxes are skipped by seek, not read or decoded here.

The sole data reference is version-zero `url ` with flags exactly 1 and no
location string; the sample-entry index is 1. `stsd` and the ISO sound prefix
must be version zero. ESDS is version zero and contains exactly bounded ES,
DecoderConfig, DecoderSpecific and SL descriptors with no ES dependency/URL
flags, OTI `0x40`, audio stream byte `0x15`, and SL configuration `0x02`.
Descriptor lengths have at most four bytes. The audio config is restricted to
AAC-LC (AOT 2), indexed sample rates 0–12, channel configurations 1–7, and three
zero GASpecificConfig flags. It is either two bytes or five bytes with exactly
the producer's explicit SBR-absent suffix `56 e5 00`. PCE, explicit frequencies,
SBR/PS, other audio object types and other config extensions are unassessed.
This gate checks the known configuration shape, not compressed-packet integrity.

All full-box versions, flags, table lengths, counts, references and run bounds
are validated before considering availability. One `stco` **or** `co64` supplies
file-relative offsets. `stsc` starts at chunk 1, has strictly increasing valid
first-chunk indices, positive samples per chunk, and description ID 1. Its run
lengths must consume exactly the `stsz` sample count. `stsz` supports positive
fixed sizes or an exactly sized array of positive sample sizes. `stts` counts
must agree; its durations are never compared to decoded duration. Optional
sample groups must be the validated `roll` pair: `sgpd` version 1, fixed 2-byte
entries with distance -1; `sbgp` version 0, valid indices and exact sample coverage.
Unknown groups, auxiliary encryption info, encrypted/external references, multiple
tracks/descriptions, `stz2`, fragments/hybrids, unsupported versions, incomplete
metadata, and any resource limit all remain unassessed.

After validation, each chunk's consecutive sample sizes are summed and checked
against one available `mdat` payload interval. Multiple `mdat` boxes and
nonmonotonic chunk offsets are allowed. All sample sizes must be consumed exactly.
A byte range pointing into a header/gap or beyond the available payload produces
the same cautious warning; it cannot distinguish missing bytes from wrong
metadata. Structurally supported edit lists (versions 0/1 with exact entry
lengths) do not alter these byte locations. Edit rates and media-time values
are not interpreted or validated by this byte-addressing check. The check includes indexed samples excluded by presentation
edits, and makes no claim about audible duration, priming or recording history.

Limits are 8 MiB of `moov` payload, 4,096 parsed boxes total, 1,000,000 samples,
100,000 chunks and 100,000 table rows. Limits are checked before reading or
iterating their contents. Table arrays remain memoryviews over bounded metadata;
there is no Python tuple per sample. Payload reads are at most 64 KiB, iteration
checkpoints occur at least every 1,024 rows/samples/chunks, and mdat lookup is
binary search. Read errors and cancellation propagate. `analyze()` still performs
its final source fingerprint and cancellable SHA256 verification after advisories.

Only the existing flags lists, warning presentation and warning counts change.
A/B attribution, version keys, review history, approvals, eligibility, previews,
and JSON/CSV field/column contracts remain unchanged. This advisory never creates
or reverses a human review decision.

## Field evidence and provenance

These are field/producer references, not a claim of full standards conformance:

- [Apple: using sample atoms](https://developer.apple.com/documentation/quicktime-file-format/using_sample_atoms)
  describes sample-to-chunk lookup, chunk offsets, and sample-size-based location.
- [Apple: sample-to-chunk table](https://developer.apple.com/documentation/quicktime-file-format/sample-to-chunk_atom/sample-to-chunk_table)
  identifies first chunk, samples per chunk and description ID.
- [Apple: atoms](https://developer.apple.com/documentation/quicktime-file-format/atoms)
  documents extended sizes and zero-to-EOF semantics.
- [Apple: encoder-delay structures](https://developer.apple.com/documentation/quicktime-file-format/using_track_structures_to_represent_encode_delay_explictly)
  and its linked group descriptions explain the roll groups and presentation edits.
- Official [FFmpeg movenc.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/movenc.c),
  reviewed blob SHA `debe1acb7e01aee21f7eb03b0c367afddedd9ad6`, functions
  `mov_write_audio_tag`, `mov_write_esds_tag`, `put_descr`, `mov_write_dref_tag`,
  and `mov_preroll_write_stbl_atoms`, supplies the exact narrow producer shapes.
- Official [FFmpeg mov.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/mov.c),
  reviewed blob SHA `edab98a037681019b9d316236e163a0c9dd698c4`, functions
  `mov_parse_stsd_audio` and `mov_build_index`, corroborates ISO audio-prefix parsing
  and accumulating sample sizes from chunk offsets. Apple QuickTime sound-version-0
  uncompressed-audio rules are **not** substituted for ISO `mp4a` rules.
- Official [FFmpeg isom.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/isom.c),
  reviewed blob SHA `0a2f93d762f6556f7b3e5e0bcafefde330527a9d`, maps AAC to OTI `0x40`.
- Official [FFmpeg aacenc.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/aacenc.c),
  reviewed blob SHA `5b1e3eff0fb60ea3a47f8a0ed4348253c61e5dd3`, function
  `put_audio_specific_config`, documents the supported config prefix and
  explicit absent-SBR marker.

An ISO 14496-12:2012 text was consulted through a third-party SRS mirror during
research, but is not represented as independently authenticated ISO-hosted evidence.
W3C MSE byte-stream profile restrictions are not generalized to ordinary M4A.

Tests use independent synthetic byte locations and installed-FFmpeg-generated
fixtures only. Supported intact fixtures must return internal `assessed_present`,
not merely lack a warning. Unknown/malformed combinations with apparent missing
bytes must return `unassessed`. A/B tests retain playable partial decodes and
existing reviews for both zero-sized and rewritten-to-EOF mdat cuts.
