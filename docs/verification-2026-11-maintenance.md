# Maintenance verification — 2026-11-03

Unreleased changes based on commit `3ab758f76ca11e7e446b8ffa33bbc94beab5f677`.
No version bump, release, merge or website deployment is included.

## Import cancellation

Import completion previously published its terminal state and then disabled
cancellation in a separate critical section. A new import could start between
those operations and lose the ability to cancel. Completion now finishes both
updates under the same lock.

The regression test deliberately starts a second import after the first becomes
observable as succeeded, cancelled or failed. All three scenarios fail on the
original code and pass after the change. An independent review repeated the fixed
test 100 times, covering 300 controlled interleavings, and also checked the
original implementation as a failing control.

## Cancelling large imports

Directory discovery, CSV reading and manifest-row validation now check for
cancellation between items. Audio hashing checks between bounded 1 MiB reads,
and analysis checks around probing and each PCM block. An interrupted decoder
iterator closes explicitly; a cancellation is re-raised rather than recorded as
an unreadable audio item. The saving-phase boundary is unchanged.

Deterministic regressions cancel on the first yielded path, CSV row, manifest
row or PCM block and reject consumption of the remainder. They also verify the
saved catalog, import source, review history and original audio hashes are
unchanged. Pre-cancelled malformed manifests report cancellation, not a parsing
failure. Additional audio tests verify bounded hashing, iterator cleanup and
exact normal-result equivalence. An independent comparison against the original
analysis code matched all fields for 24 randomized PCM fixtures spanning four
sample widths, three channel counts and two sample rates.

Optional FFmpeg regressions ran with the installed tools: WAV-to-FLAC analysis
matches with and without checkpoints, and cancellation after the first native
PCM yield closes the generator, stops its subprocess and closes stdout.

A generated five-minute PCM WAV import reached its cancelled terminal state
about 0.011 seconds after the cancellation request in one local test. This is an
observation, not a performance guarantee. Ongoing JSON parsing, sorting, system
file reads, synchronous probes and blocked decoder reads cannot be interrupted
by these cooperative checks; configured FFmpeg timeouts still apply.

## Import status recovery

A failed status read previously stopped polling permanently, leaving import
controls disabled even after the backend finished. Read-only status checks now
retry at 700 ms, 1.4 s, 2.8 s and 5.6 s, capped at 10 s between attempts. Each
request has an eight-second deadline, and one continuous outage produces one
error notice. Successful status reads reset the backoff. Import, browse, rescan
and cancellation POST requests are never automatically replayed.

An accepted mutation starts a new observation generation. Older results and
errors cannot replace its status or create another polling chain. Cancellation
failure also resumes observation, since the import may already have completed.
Initial restoration remains quiet for old terminal jobs, but reports completion
of jobs seen running. Page-cache suspension stops the watcher and restoration
restarts it. Timeout errors use the existing localized network message.

Twelve controller and ten actual-workbench callback tests cover deadlines,
backoff, late responses, draft preservation, cancellation, lifecycle and success
notices. Independent old-code controls reproduced both permanent polling loss
and stale status overwrites. Failed catalog refreshes no longer show a false
success notice. Completion-specific catalog recovery is described below; ordinary
manual and startup reads remain single attempts. If a lower-level request
ignores cancellation, it may remain physically pending, but its eventual result
is discarded. Page-cache and abort behavior were tested with controlled doubles,
not a real browser.

## Import progress semantics

The progress bar now has a localized accessible name and references the current
file/count description. Discovery with an unknown total uses native indeterminate
progress rather than a misleading measurable zero percent. Once a total is
known, the existing percentage and file counter remain unchanged.

A separate, visually hidden polite status reports reading, stopping and saving
phase changes. Filenames and counts are deliberately not live. Repeated polls
in the same phase do not rewrite its text; terminal jobs clear it, and a later
import can announce its reading phase again. Cancellation still takes precedence
over saving and keeps Stop disabled. The stopping message no longer promises to
wait for a whole file, matching the existing cooperative cancellation checks.

Eleven tests cover the real render handler, bilingual localization loop, static
semantics, unknown/known transitions, repeated snapshots and successive imports.
They fail on the preceding source and pass after the change. Independent review
found no blocking issues. This verifies markup and update logic, not the native
progress appearance or actual screen-reader announcements.

## Completed-import catalog recovery

When a newly completed import cannot refresh its catalog because of a temporary
network failure, that read now recovers within its original refresh generation.
Only the completion path opts in. Network-classified failures and full-request
eight-second deadlines retry with the same 700 ms to 10 s capped delays. The
deadline includes JSON body decoding. Other API/rendering errors are not retried,
and no POST or review write enters this mechanism.

Edits, navigation, mutation starts, accepted new jobs, newer refreshes and
pagehide cancel the attempt and its timers immediately, even if the transport
ignores abort. Cancellation does not acquire new ownership later. A suspended
page may resume only its explicitly recorded, still-eligible completed-job read,
before any catalog application; restored historical terminal jobs remain quiet.
The reconnect notice appears once, clears when cancelled, and cannot clear newer
feedback. Success appears only for a still-owned, applied catalog with no current
waveform load error. Existing dirty drafts are preserved without an extra prompt.

Eleven reader tests and 27 actual-workbench integration tests cover retry limits,
fetch/body hangs, late outcomes, cancellation, page-cache restoration, notices,
terminal deduplication and waveform errors. The same recovery regression against
the previous workbench fails at the missing second GET, demonstrating the original
failure. These tests use controlled time and DOM/media doubles, not native browser
network or page-cache testing. Server-side HTTP errors without a network code,
manual refresh and startup failures still require the existing manual retry.

## Refresh draft safety

Catalog reads now stage their result until they verify that they still belong to
this refresh. New edits, navigation, save/batch/undo starts, accepted import jobs
and newer refreshes invalidate older results. A late response can no longer erase
a draft begun during the read, return the user to an older selection, roll the
catalog backward or clear the selection while a save is in progress. Stale
failures also stay silent rather than replacing newer feedback.

The internal refresh selection applies without a second asynchronous discard
confirmation gap. Ordinary navigation and manual refresh retain the existing
explicit discard confirmation. Forced background refresh does not bypass draft
safety. Refresh-owned waveform failures likewise check ownership; current and
ordinary-selection errors still appear, and valid waveform data can still draw
while a new draft is being edited.

Fifteen actual-control-flow tests cover those races, healthy refreshes, current
errors and discard confirmation. Against the pre-change backup, ten of the first
twelve tests fail as expected and two healthy controls pass. Removing only the
waveform-error guard reproduces the additional regression while its two current-
error controls pass. These are intentional negative controls, not failures of
the maintained code. Tests use deferred I/O and DOM doubles. Persistent review
records and source audio are not modified by the refresh guard.

## Input-method keyboard safety

Command search, marker creation/editing, global save/command shortcuts and the
website's sample-note editor now leave composing key events to the input method.
Enter and candidate arrows no longer run commands during composition; Enter and
Escape cannot prematurely commit or discard a marker, save a review, or hide the
sample editor. The guard checks both `isComposing` and the legacy `keyCode` 229
boundary case, as described in [MDN's keydown guidance](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event#keydown_events_with_ime).

Twenty-two extracted-handler tests cover both signals, Ctrl and Meta variants,
unchanged draft/editor/focus state and the immediately following ordinary key.
The same tests fail against the pre-change backup, reproducing the missing
protection. This verifies keyboard event logic; it is not a test of a real
operating-system Chinese, Japanese or Korean input method or browser.

## Exact trim boundaries

Generated trim edits now preserve the exact timestamp instead of rounding saved
values to milliseconds. This prevents a fractional clip end from exceeding its
duration and a submillisecond clip from collapsing to a zero-length range.
Dragging one handle changes only that input, preserving an untouched blank,
invalid or high-precision opposite boundary. Mark-in/out, silence suggestions
and Reset Range clear stale validation messages on fields they replace. Typed
values and server-side validation remain unchanged.

Twelve new Node tests cover the editor, actual workbench event bodies with input
doubles, waveform keyboard callback wiring and marker timestamp formatting.
Four workbench regressions fail against the original handlers and pass after
the fix. An independent check preserved exact ends for 10,000 sample-rate-derived
durations. The server test also traverses the workbench module imports over
loopback HTTP and verifies successful JavaScript responses, including `trim.js`.
These are logic/HTTP checks, not a browser visual or native-form assessment.

Marker display now carries milliseconds into the next minute instead of showing
`0:60.000`. Text-only marker edits retain the exact stored timestamp. Explicitly
typing a rounded time past the true end remains invalid; typed markers are not
silently clamped.

## Waveform handle precision and accessibility

Waveform pointer/keyboard editing and slider ARIA attributes now share the same
range limits. A valid manually entered interval narrower than one millisecond
keeps both exact endpoints; editing a handle no longer expands or shifts the
opposite endpoint. Submillisecond clips expose reachable minimum/maximum values,
and `aria-valuenow` no longer rounds to zero or beyond the real clip end. Normal
intervals retain the existing one-millisecond inward limit.

Nine additional tests cover the shared limits, sample-derived intervals,
floating-point extremes, actual paint code with DOM/canvas doubles and keyboard
callbacks. All nine fail against the previous editing/painting implementation
and pass after the change. An independent run checked 99,924 valid intervals,
1,199,088 extreme edits and 294 invalid-input normalization combinations. These
checks verify generated attributes and logic, not real assistive-technology
speech or browser interaction.

## A/B playback continuity

A media session keeps the intended position and playing/paused state separate
from the temporary native reset while a preview loads. Rapid A/B switches retain
that intent; a remembered position also survives a switch before the first
metadata event. Buttons, Space, skip, scrub, marker seeks and position memory
use the same session. Explicit pauses are not undone by a pending load, and
obsolete play failures do not produce notices for a newer source.

Transport rendering rejects synchronous reentry and maintains one animation
chain. Looping is limited to the playable overlap with the actual source. A
short reference with no overlap pauses with an explanation instead of repeatedly
seeking beyond its duration. Non-loop playback remains available.

Eighteen session tests and eight transport/workbench integration tests pass.
Three actual workbench-handler tests fail on the preceding implementation and
pass after the change. Tests use queued media-event doubles and controlled
animation callbacks. An independent review reproduced and then verified the
reentry and duplicate-animation fixes. These checks do not establish native
browser playback, gapless switching or perceived audio quality.

## Reference waveform timing

The A/B importer accepts time-aligned references up to 50 ms different in length.
The waveform previously stretched every reference to the original duration,
moving visible peaks away from their real preview timestamps. The renderer now
receives separate sample and review-timeline durations. Peaks use the current
variant's duration; trim, seek, notes, zoom and pan retain the original timeline.
A shorter reference leaves a baseline after its end, and a longer tail is
clipped at the shared viewport boundary.

Eight tests inspect actual canvas drawing calls and the workbench's draw handler.
Shorter/longer reference peaks, tail clipping, zoom and pan are covered alongside
equal-duration and four-argument compatibility controls. Six fail on the previous
implementation and pass after this change. This removes the A/B duration scaling
error; reduced peak buckets and a possibly shorter final bucket still mean the
waveform is not a sample-exact alignment display. No new screenshots are claimed.

## Note navigation and keyboard continuity

Clicking a time-note timestamp or waveform tick now ends an active one-shot
audition before seeking. A note beyond the old audition endpoint no longer
immediately pauses playback. The prior loop preference is restored, ordinary
paused seeks stay paused, and neither action changes saved review data.

Deleting a focused note moves focus to the adjacent Remove control, or the
add-note input when no notes remain. Pending time edits can reorder notes before
deletion; the focus target follows that updated order. Invalid pending edits
block removal and retain validation focus. Programmatic deletion does not take
focus from unrelated controls.

Eleven mounted-control tests exercise the actual workbench marker wiring with
DOM and media doubles. Seven regressions fail on the pre-change source and pass
after the change; four unchanged controls also pass. An independent code review
found no blocking issues. These checks verify event ordering and intended focus
targets, not native browser playback or real screen-reader announcements.

## Failed export retries

The CLI now validates and fully serializes JSON/CSV, including UTF-8 encoding,
before creating an output directory or file. Changed/missing sources, invalid
JSON numbers and encoding failures no longer leave empty files that block a
corrected retry. Successful exports still create missing parent directories and
use exclusive creation, protecting preexisting destinations, source files and
the review database. Binary UTF-8 output retains the CSV BOM and original CRLF
without a second operating-system newline conversion.

Seven new tests cover those failures, corrected retries, status filters and a
destination created during preparation. Independent checks also rejected four
types of existing symlinks in both formats without changing links or targets.
Windows newline behavior was reviewed in code and bytes were tested on Linux;
this is not a Windows execution result. Disk-write/flush failures or interrupted
processes can still leave incomplete output; this is not an atomic-write claim.

## Website workspace status

The website no longer assumes that any localhost preview is a running review
workspace. It starts with download/setup links and checks only the current
HTTP(S) loopback origin's public `/api/version` response. Links switch to the
workspace only when the response identifies `audio-review-desk` and a version.
The API's new application field is additive; its existing version field remains.

Public and file pages make no probes of the visitor's computer. The probe omits
credentials, rejects redirects, avoids cached responses and times out through
body reading. It never reads the private catalog. Errors, old version-only
responses and unrelated local servers retain the download fallback. Repeated
focus checks are coalesced, and a language change during verification is retained.
Nine tests cover request policy, timeout/error cases and actual translation logic
with DOM doubles. This is a status snapshot on load/focus, not continuous service
monitoring. The server's strict Host validation is unchanged.

## Website font loading

The public tour no longer unconditionally preloads the full MiSans font. Its
existing CSS, fallback order, original font bytes and licence remain unchanged,
so MiSans is still available when the page needs it. The correct Inter preload
remains, and the local workbench's preload behavior is unchanged.

Three static tests verify the selected Latin font, a 100 KiB declared preload
budget, original MiSans digest and CSS/build availability. The tour's declared
font-preload payload falls from 4,906,696 to 48,072 bytes, a reduction of
4,858,624 bytes. This is a measured markup/asset budget, not a claim about actual
network transfer, loading time or LCP; some browsers/platforms may still load
MiSans on demand. The same budget test fails with the pre-change HTML. No font
subsetting, typeface replacement, glyph removal or licence modification occurred.

## Interface and website

The workbench separates primary-action fill, hover and text colors from link
colors. Secondary copy and keyboard focus colors were strengthened. Press
scaling is removed when reduced motion is requested; timeline markers retain
their positioning transform.

Calculated opaque-color contrast ratios for primary buttons:

| Theme | Normal | Hover |
| --- | ---: | ---: |
| Light | 5.38:1 | 6.59:1 |
| Dark | 6.56:1 | 8.42:1 |

Static tests require at least 4.5:1 for primary text in both states and for
secondary/link text on the named workbench surfaces. These tests cover the
specified color pairs, not every composited pixel, disabled control or browser
rendering. They do not establish whole-product WCAG conformance.

The public website's download links point to the release page even before
JavaScript runs. The hero explains the Python/source setup requirement. After
the local workspace check succeeds, JavaScript changes those links to the
workspace and the hint to the local-ready message. Both README languages now
distinguish the public examples from persistent local review and document the
generated example workflow and spectrogram limits.

## Review-history continuity (2026-11-03)

Review history now reloads independently after a save that leaves the clip open.
A request generation and selection generation prevent older history responses or
errors from replacing the current panel. Selection clears previous-clip rows,
and the next history read shows a local loading message. Current failures use a
bilingual panel-local retry explanation instead of replacing save/error notices.

Starting a review mutation invalidates pending history reads. Opening history
while the mutation is busy does not fetch a pre-commit snapshot. Failed saves,
undo operations and batch changes recover the committed history after the
mutation settles. Undo/batch also recover an open panel if their catalog refresh
fails. Normal advancing/undo/batch selections close the panel without an extra
history GET. Completing the queue closes and invalidates history; advancing with
no next visible clip refreshes history if the current clip remains visible.

Verification for this change:

- All 323 Node tests passed, including 18 new deferred-I/O history tests running
  extracted workbench control flow with DOM/render doubles. The queue-completion
  test executes the actual `showCompletion()` function with those doubles.
- The final 18-test history suite against the fully restored pre-change
  workbench source produced 15 failures and 3 compatibility passes, with no
  cancelled tests. The initial nine tests, run before source edits, produced
  seven failures and two passes.
- Full Python suites on 3.12.14 and 3.13.5: 124 tests passed on each. The earlier
  targeted workflow/server checks also passed. An initial bare Python invocation
  could not import the uninstalled package and did not execute those suites;
  the corrected source runs used `PYTHONPATH=src`.
- JavaScript syntax checks for workbench/copy and `git diff --check` passed.
- Coverage includes failed mutations, busy reopening, closing/reopening,
  A-to-B-to-A selection, out-of-order success/error, failed post-save state/history
  reads, unchanged zero-score/marker rendering and no unnecessary history reads
  when the panel is closed or selection advances.

These are local deterministic control-flow checks, not native browser, visual,
listening or assistive-technology acceptance. No browser launch, remote
publication, deployment or versioned release was performed for this change.

## Undo recovery (2026-11-03)

Undo now applies the server's committed review before unlocking the form. Notes,
time notes, issues, scores, trim boundaries and the next expected review version
remain correct if the separate catalog read fails. Both the current selection
and its catalog item are updated without replacing their identities, and cached
status/search filters are invalidated. A clip that leaves the active filter stays
open with the existing outside-filter explanation.

A failed catalog read now gives a persistent bilingual explanation that undo was
saved but totals could not refresh, with a manual-refresh next step. Totals remain
server-derived; overlapping audio durations are not approximated locally. Newer
edits, navigation, refreshes and mutations invalidate the old undo refresh's
feedback. A waveform failure after a successful catalog read retains its specific
error instead of being replaced by a success message. Existing history recovery
is preserved. Batch mutations and the server API are unchanged.

Verification for this change:

- All 342 Node tests passed. The 16 new tests execute the actual undo, refresh,
  selection, filter-cache and review-form rendering code with deferred I/O and
  DOM/media doubles. The focused undo/history/refresh suite passed all 49 tests.
- Against the fully restored pre-change workbench, the same 16-test suite
  produced 13 regression failures and 3 compatibility passes, with no cancelled
  tests. This reproduces stale review versions, incorrect form/filter state and
  obsolete success feedback rather than only inspecting source text.
- Checks include zero scores, exact trim values, restoring empty fields,
  selected/catalog identity separation, subsequent Save and Undo payloads,
  discard cancellation, rejected undo, stale reads and specific waveform errors.
- Existing history tests now supply the actual undo-response shape, including
  its authoritative review; production behavior was not weakened for old mocks.
- The initial Chinese wording introduced one character outside the recorded UI
  coverage. Revised wording uses the existing coverage; all four focused font
  tests then passed. Font files, manifests and coverage tests are unchanged.
- Workbench/copy JavaScript syntax checks and `git diff --check` passed.

These are deterministic local checks, not native-browser interaction, visual,
listening or assistive-technology acceptance. No browser launch, publication or
deployment was performed. The full pre-change backup was restored and verified
before implementation.

## Save and continue focus

Save and continue now restores the initiating control after a failed save or
when no next clip matches the current filter. Successful advancement focuses
the new clip heading as soon as its details appear, before its waveform request
settles. A waveform failure therefore cannot leave the focus destination on the
previous clip. The heading has `tabindex="-1"`, permitting programmatic focus
without adding an extra stop to ordinary Tab navigation. Its focus call allows
normal scrolling so the new context can be revealed in stacked layouts;
restoring an existing control keeps `preventScroll`.

A save observes focus only while it still needs to make that decision. Moving
focus to another control revokes ownership, including when that newer control
later blurs. Slow waveform reads do not retain the observer, and superseded
selections do not invoke the focus hook. Ordinary Save and detached time-note
focus restoration remain intact. The existing queue-completion heading behavior
is unchanged. Mobile library collapse and focus-mode transitions are outside
this change.

Verification for this change:

- All 367 Node tests passed. The 25 new focus tests execute the actual save,
  selection, completion and queue-continuation logic with deferred I/O and DOM
  focus doubles. The related focus/history/refresh/completion/undo suites passed
  all 101 tests.
- Against the fully restored pre-change `8bd27f4` source and markup, the same
  25-test suite produced 8 regression failures and 17 compatibility passes,
  with no cancelled tests. This reproduces failed/no-next restoration and
  missing next-clip focus rather than only inspecting source text.
- Coverage includes slow or failed waveform reads, failed post-save catalog
  reads, newer user focus during writes and reads, subsequent blur, cancelled
  selection intent, observer cleanup, external form-associated trim controls,
  marker fallback, validation exits, ordinary Save and queue completion.
- Existing non-focus test doubles now provide document event-listener methods;
  their assertions and production behavior were not weakened.
- Workbench and focus-test JavaScript syntax checks and `git diff --check` passed.

These tests model a disabled focused control losing focus and verify intended
focus targets and options. They do not establish native-browser scrolling,
visual focus appearance or real assistive-technology announcements. No browser
launch, publication or deployment was performed. The full pre-change backup was
restored and verified before implementation.

## Waveform read recovery (2026-11-03)

Missing waveform samples no longer draw the same minimum-height bars as actual
silence. Nonempty zero-valued samples retain their quiet baseline. While peaks
are absent, the shared timeline, seek position, precise trim handles, markers,
zoom and pan continue to work. A compact bilingual status distinguishes loading,
read failure, interruption, unavailable peaks and a ready waveform. Its retry
control is separate from spectrogram status and uses the existing theme colors.

Retry reads only the current clip's stored peaks. It does not reselect the clip,
reload or pause media, cancel an audition, reset A/B or zoom, restore review
fields, or send a review mutation. Duplicate pending reads coalesce. Each attempt
has an eight-second deadline covering fetch and JSON-body decoding; there are no
automatic waveform retries. Obsolete requests are aborted and settled even when
the transport ignores cancellation, and late successes or errors are ignored.
Selection identity and request identity own the result; a draft edit does not
prevent valid peaks for the same clip from arriving.

Accepted navigation, an empty catalog, queue completion and pagehide cancel a
pending read. A cancelled discard dialog leaves the current read intact. A
retained panel reopened after completion or a page-cache restore offers an
explicit retry after interruption, without restarting playback. Initial
selection and refresh still return failure when their waveform read fails, and
stale refresh errors cannot replace newer feedback. Successful retry clears only
the exact still-current waveform error notice, including when newer feedback
happens to contain the same text.

The retry button retains focus while loading. If it still owns focus when data
arrives, focus moves to the visible status text; background completion never
reclaims focus from another control. Synchronous rendering callback failures
settle and clean up the read. A failed loading or peak-rendering callback gets
one best-effort error status so Retry can remain available; failure of that error
renderer does not cause a recursive loop or unobserved read rejection.

Verification for this round:

- All 413 Node tests passed. The 46 new tests comprise six actual renderer/draw
  controls, 19 reader/deadline/callback tests and 21 actual-workbench control-flow
  tests with controlled I/O, clocks and DOM/media doubles.
- Against the exact restored pre-change source at
  `2878351e517f6901ad75a00c5bb4c8f9ea52564f`, the renderer suite had one expected
  regression failure and five compatibility passes: absent data and real silence
  produced 100 identical bars. The workbench suite had 20 expected regression
  failures and one A/B compatibility pass. Neither negative-control run had
  cancelled tests. These are intentional baseline failures, not final failures.
- Existing refresh, completion, undo, history and save-focus assertions were
  retained; their test doubles were extended for the new reader/status controls.
- The font-bundle/hash/character-coverage test passed separately on Python 3.13.
  All new Chinese copy uses the existing manifest characters. No font binaries
  or font manifests changed. JavaScript syntax and `git diff --check` passed.
- The targeted Python 3.13 font/server command passed all 22 tests, including the
  served workbench module graph. An earlier invocation was interrupted before
  its server summary while a network approval was cancelled before a decision;
  that incomplete attempt is not counted as a pass. A later repeat of the same
  command completed successfully. Full Python 3.12.14 and 3.13.5 suites then
  passed all 124 tests each. A fresh wheel matched all 87 current static assets
  byte-for-byte, and its independent normal installation passed all 124 tests.

The full pre-edit repository backup was restored and verified before edits.
No version change, remote publication or deployment is part of this round.
Changes are retained in local Git history. These are local deterministic tests, not browser rendering, listening, real page-cache or
assistive-technology acceptance. No new browser launch or screenshot is claimed.

## Batch save recovery

Batch changes now return the complete committed reviews as an additive `reviews`
field alongside the existing numeric `saved` count. The records come directly
from the existing transaction's writes and are returned only after successful
commit. The Python `batch_review()` method still returns an integer and executes
one batch transaction. No second transaction reads back mutation results, so a
later writer cannot replace the version being acknowledged.

The workbench validates complete key coverage and basic review shape before
applying any returned record. It reconciles affected catalog items and a detached
open selection without replacing their identities, invalidates cached filters,
and restores affected review controls before editing is unlocked. Notes, zero
scores, exact trims, issue labels and time notes remain intact. Only checked keys
in the acknowledged batch are cleared; unrelated selections remain. A clip that
leaves the active filter stays open with the existing outside-filter feedback.

The separate catalog read still supplies authoritative totals. If it fails, a
persistent bilingual notice distinguishes saved reviews from unavailable totals.
New edits, navigation, refreshes and mutations own their feedback. A waveform
failure after a successful catalog read retains its specific error and retry
control. Count-only responses from older servers can recover through the catalog;
if that read fails, the notice asks the user to refresh saved records before
continuing. Incomplete, duplicate, unexpected or malformed returned records are
not partially applied. An inconsistent saved count uses a dedicated localized
error that asks for a catalog refresh before trying again. No mutation is
retried automatically and no versions or overlapping-duration totals are guessed.

Verification for this round:

- All 440 Node tests passed, including 27 new tests executing the actual batch,
  refresh, selection, filter and review-form code with controlled I/O and DOM/media
  doubles. The related batch/undo/history/refresh/focus/waveform suite passed all
  122 tests. Existing history fixtures now supply the genuine complete batch
  response shape; their assertions were retained.
- Against the exact restored pre-change workbench at
  `6fa6d6f864313356ba3be2eed9e393f26f590a64`, the same 27-test suite produced 23
  expected regression failures and four compatibility passes, with no cancelled
  tests. The negative-control fixture settles the old implementation's unexpected
  catalog read before asserting so failures are not dangling-promise cancellations.
- Eight new backend tests passed. They check exact returned fields/history,
  the integer wrapper, stale/source/validation rejection, rollback after the first
  write, failure at transaction exit and another writer immediately after commit.
  All 14 existing workflow tests and 23 server tests passed. Two new HTTP tests
  cover the additive response and a conflict without false success fields.
- The two HTTP tests against the restored pre-change server produced one expected
  missing-`reviews` error and one conflict-compatibility pass. These deliberate
  baseline failures are not failures of the final implementation.
- Tests cover the next Save, Undo and Batch payloads, detached selection identity,
  zero and empty fields, exact fractional markers/trims, status/search caches,
  draft discard, newer work, unchanged server-derived totals, waveform retry,
  old-server responses and malformed/incomplete results. The inconsistent-result
  tests use the production bilingual error translator, not a raw-message stub.
- Full Python 3.12.14 and 3.13.5 suites each passed all 134 tests. A fresh
  wheel matched all 87 current static assets byte-for-byte, and its independent
  normal installation passed all 134 tests.
- Chinese copy uses the existing character manifest. The font-bundle/hash/coverage
  test, JavaScript syntax checks and `git diff --check` passed. No font binaries,
  manifest, batch reentrancy behavior or unrelated focus behavior changed.

The complete pre-edit repository backup was restored and verified before edits.
These are deterministic local handler/storage checks, not native-browser,
listening or assistive-technology acceptance. No browser retry, remote write,
push, deployment or version change is part of this round.

## Bounded read-only requests

A successful single-review save previously held the form and navigation locked
while waiting indefinitely for its subsequent catalog read. Read-only GET
requests now have an eight-second deadline covering both fetch and JSON-body
decoding. The one-shot helper settles even when a transport ignores abort,
cleans up its timer and external abort listener, and observes late rejection
without applying stale data. It never retries. POST requests, including saving,
batch changes, import, export preparation and the native file picker, retain
their original lifecycle. Existing import read recovery remains responsible
for its explicit backoff; this helper does not add another retry loop.

After an acknowledged save, a stalled catalog read now releases review controls,
retains the committed review/version, and shows a persistent saved-but-totals-
unavailable warning. Save-and-continue restores that warning when selection
clears old feedback, before the next clip can produce its own waveform error.
Keyboard focus follows the existing ownership rules. Missing totals cannot
announce queue completion from a stale zero-pending count. Server-derived totals
are never guessed, and a later read cannot replace new edits or a newer save.
Initial and manual catalog reads also terminate with the existing retry/error
controls rather than leaving an indefinite loading state.

Verification for this round:

- All 471 Node tests passed. The 31 new cases cover the helper, actual request
  wrapper, initial/manual refresh, and actual Save/Save-and-continue flow with
  controlled time, fetch, JSON, DOM and media doubles. Existing waveform and
  import fixtures now inject the real helper; their assertions were retained.
- Against the exact restored pre-change workbench at
  `6dbaed2a135c5efd8174f7113ad05297fba476f4`, the 24-test read suite produced
  13 expected regression failures and 11 compatibility passes. The seven new
  save cases each failed as expected. Neither negative-control run cancelled
  tests or depended on unresolved test promises to report failure.
- Coverage includes non-cooperative transports, timeout/abort ordering, listener
  and timer cleanup, case-insensitive GET/POST handling, preserving request
  options, API errors, subsequent explicit saves, unchanged authoritative counts,
  focus ownership, refresh retry and old responses arriving after recovery.
- Initial full Python and installed-wheel checks caught a missing static-module
  allowlist entry. It was fixed and the module-graph test now explicitly requires
  the new helper. The earlier failing logs are retained as intermediate evidence,
  not reported as final success.

Final full Python 3.12.14 and 3.13.5 suites each passed all 134 tests. A fresh
wheel matched all 88 static assets byte-for-byte, and its independent normal
installation passed all 134 tests. JavaScript syntax checks, Python compilation,
static HTML references and `git diff --check` passed.

The complete pre-edit repository backup was extracted and verified against all
521 regular files, with matching Git HEAD and a successful Git integrity check.
These are deterministic local checks, not browser, listening or assistive-
technology acceptance. No browser retry, remote write, version change or
publication is part of this round.

## Batch selection context and clearing

The batch action area now visibly shows its selected total. The earlier total
was present in the DOM but hidden by CSS. Selections intentionally remain checked
when search or status filters change, and the action area now reports how many
selected clips are outside the current results. The checkbox is labeled Select
visible to distinguish its scope. More than 500 selections displays the existing
server limit rather than silently disabling Apply; nothing is truncated.

A native Clear selection button removes all checked items, including hidden ones,
without changing the current clip, review draft, search, status filter or sort.
If that disappearing button held focus, focus moves to Select visible or to
search when no results are available. Other focus is left alone. Batch actions
and their status selector are disabled while a write is active. The compact
batch area uses a two-column grid with a wrapping summary and contextual text;
its Apply control refers to the count and explanation for accessible context.
Chinese and English usage notes describe the selection scope and 500-item limit.

Verification for this round:

- All 488 Node tests passed, including 17 new cases executing actual filtering,
  selection summary, clear action, queue rendering and row/select-visible events
  with DOM doubles. The exact restored pre-change workbench at
  `40443b1fc86530fe9b898812632cc49e2cc7fc38` fails all 17 new cases as expected,
  with no cancelled tests.
- Coverage includes hidden-only and mixed selections, zero/500/501 selections,
  removing the 501st selection, deselecting only visible results, both languages,
  busy/unlock, repeated clearing, native control semantics, count visibility,
  draft and object identity preservation, non-default filter/sort and focus.
- Python 3.12.14 and 3.13.5 each passed all 134 tests. A fresh wheel matched
  all 88 static assets byte-for-byte and passed all 134 tests after independent
  normal installation. Font hashes/character coverage, documentation links,
  JavaScript syntax, HTML/ARIA references and `git diff --check` passed. No font
  files or character manifest changed.

The full pre-edit repository backup was restored and compared against all
540 regular files; Git integrity and exact HEAD checks passed. No browser
geometry, screen-reader announcement or touch-device acceptance is claimed.
No browser retry, remote write, version change or publication was attempted.

## Consistent next-pending navigation

The command palette previously searched for the first pending clip other than
the current one. With three pending clips A/B/C, using its action from B returned
to A while the sidebar advanced to C. Repeated palette use could bounce between
the first two clips. Both entry points now use one shared action and the existing
`nextPendingItem` helper. They follow full catalog order, skip non-pending
reviews, wrap once and exclude the current clip. Current filters are unchanged.
The action resolves against the current catalog and selected item when invoked,
respects the existing unsaved-draft gate, and does nothing while a write is busy.

Verification for this round:

- All 514 Node tests passed, including 26 new cases executing the actual palette
  configuration, sidebar event listener, selection flow and discard gate.
  Tests cover forward/wrap/skip/missing-current behavior, a sole pending current
  clip, cancelled and accepted discard, busy/unlock, repeated palette traversal,
  one shared handler, current data after opening the palette, no current
  selection, empty catalogs and unchanged search/filter/sort controls.
- The same suite against the restored pre-change workbench at
  `dfc897e0c8beac7083e695cee2414e8558b32410` produced eight expected failures
  and 18 compatibility passes, with no cancelled tests.

Full Python 3.12.14 and 3.13.5 suites each passed all 134 tests. A fresh wheel
matched all 88 static assets byte-for-byte and passed all 134 tests after
independent normal installation. JavaScript syntax, HTML/ARIA references,
documentation links and `git diff --check` passed.

The full pre-edit repository backup was restored and compared against all
556 regular files; Git integrity and exact HEAD checks passed. These are local
workflow checks, not browser, listening or assistive-technology acceptance.
No browser retry, remote write, version change or publication was attempted.

## Reveal the active row in long queues

Selecting an offscreen clip previously moved its queue highlight without moving
the overflow viewport, so keyboard or command-palette navigation could leave the
active row out of sight. Selection now reveals that row with the smallest needed
vertical movement in the queue container. It uses the container's client area,
including its border, clamps to scroll bounds and aligns unusually tall rows at
the top. It does not use document-wide `scrollIntoView`, move focus, scroll
ancestors or schedule a later animation. Movement is explicitly instant.

Routine queue rerenders and a catalog refresh that retains the current clip do
not reset manual scrolling. Initial restoration and a replacement selection are
revealed. Collapsed libraries, missing/filtered-out rows and selections blocked
by a write or rejected draft discard do not scroll. Selection supersession is
checked before the synchronous reveal, so an older navigation cannot scroll the
list afterward.

Verification for this round:

- All 540 Node tests passed. The 26 new cases execute the actual reveal helper,
  selection and refresh with controlled rectangles, DOM and scroll doubles.
  They cover clipped/visible/distant/tall rows, fractional positions, borders,
  scroll limits, hidden and missing rows, focus preservation, initial restore,
  same-clip refresh, manual scroll, filtered-out selection, rapid supersession,
  busy/discard guards and replacement after a missing selected clip.
- The same suite against the exact restored pre-change workbench at
  `5f0ef175b0a738561ba3e7b56b803f8a261a6dfb` produced 15 expected failures
  and 11 compatibility passes, with no cancelled tests. An absent helper is a
  deliberate no-op in that control, rather than a fixture loading error.
- Python 3.12.14 and 3.13.5 each passed all 134 tests. A fresh wheel matched
  all 88 static assets byte-for-byte and passed all 134 tests after independent
  normal installation. JavaScript syntax, HTML/ARIA references, documentation
  links and `git diff --check` passed.

The full pre-edit repository backup was restored and compared against all
569 regular files; Git integrity and exact HEAD checks passed. Native browser
layout, scrolling, frame rate and assistive-technology behavior remain unverified.
No browser retry, remote write, version change or publication was attempted.

## One action per shortcut press

Holding Ctrl/Cmd+Enter could submit another review after the previous request
completed, because the busy guard only protected overlapping writes. Holding
Ctrl/Cmd+K repeatedly opened and closed the command palette, and held Space,
F and B repeatedly toggled playback, focus mode or A/B comparison. These one-shot
shortcuts now ignore keyboard repeat events. Existing default suppression stays
in place, so ignored global Space repeats do not scroll the page. Native Space
behavior on buttons, links, summaries and form fields remains untouched, as do
IME composition and held J/K queue movement. A fresh keypress works immediately.

Verification for this round:

- All 570 Node tests passed. The 30 new cases execute the real document handler
  with controlled events and targets, including two cases using the actual Save
  function and deferred POST/catalog responses. Those establish that a repeat
  after a completed save cannot send another POST, while a fresh press can.
- Coverage includes both modifiers, repeated and orphan events, native text and
  Space behavior, modal exclusions, IME/legacy-229 precedence, held J/K, menu
  dismissal elsewhere, busy-to-idle and newly decoded audio transitions, F/B
  toggle behavior and immediate recovery on a fresh press.
- Against the exact restored pre-change workbench at
  `b75bf462ecf2f7a03409f79494515fc02633e1a1`, the 28-test handler suite
  produced 13 expected failures and 15 compatibility passes. Both actual-save
  repeat cases failed as expected, with no cancelled tests in either run.
- Python 3.12.14 and 3.13.5 each passed all 134 tests. A fresh wheel matched
  all 88 static assets byte-for-byte and passed all 134 tests after independent
  normal installation. JavaScript syntax, HTML/ARIA references, documentation
  links and `git diff --check` passed.

The full pre-edit repository backup was restored and compared against all
580 regular files; Git integrity and exact HEAD checks passed. These controlled
checks do not claim OS key-repeat delivery, browser focus or native-device
acceptance. No browser retry, remote write, version change or publication was
attempted.

## Interrupted scrub ownership

A progress-bar gesture previously kept its initial playback intent after a
catalog refresh selected another source. Releasing the old gesture could then
automatically play that replacement, even though selection explicitly requested
paused playback. An old drag could also seek the replacement to its own position.

A scrub now captures the media session's intent revision after its own pause.
Source changes, later explicit play/pause actions, cancellation and errors revoke
that gesture's seek/resume authority. A rejected input redraws the current owned
position, so the native slider does not retain the stale value it received before
the input handler ran. Finishing a gesture clears it once. Normal seeks do not
change the revision, and delayed native events do not revoke a newer gesture.
This preserves scrubbing begun during an already-pending A/B source load.

Verification for this round:

- All 586 Node tests passed. The 16 new cases use the actual media-session and
  transport modules, plus the actual workbench selection function, with controlled
  DOM/media events. They cover replacement selection with metadata before and
  after release, same-key source changes, stale input and release, slider recovery,
  later explicit playback intent, cancel/error, normal playing/paused scrubs,
  pending A/B loads, queued native events, keyboard seeking, fresh gestures and
  duplicate termination. Separate release-only cases establish unintended
  playback independently of stale seek failures.
- Against the exact restored pre-change repository at
  `6a4df8b98a52c5fd9bf1ace35bc692c7efd165da`, these cases produced 11 expected
  failures and five compatibility passes, with no cancelled tests.
- Independent review reproduced a stale-slider display in the first draft even
  after source playback ownership was fixed. The input rejection now refreshes
  its visible position and regression assertions check both media and slider.
  Removing only that repaint from the fixed source produced three expected
  failures and 13 passes, independently detecting the display regression.
- Python 3.12.14 and 3.13.5 each passed all 134 tests. A fresh wheel matched
  all 88 static assets byte-for-byte and passed all 134 tests after independent
  normal installation. JavaScript syntax, HTML/ARIA references, documentation
  links and `git diff --check` passed.

The full pre-edit repository backup was restored and compared against all
592 regular files; Git integrity and exact HEAD checks passed. These are simulated
event checks, not real-browser pointer, audio or assistive-technology acceptance.
No browser retry, remote write, version change or publication was attempted.

## Load historical reviews as local drafts

Review history now lists the latest entries first, in compact cards showing the
saved decision, score, issue labels, kept range, note and time notes. An older
entry can be loaded into the review form as an unsaved draft. The panel and the
persistent confirmation message explicitly require choosing Save afterward.
Loading itself sends no write and never replaces the selected clip's committed
review, current version, catalog totals or history. The existing Save path still
uses that current version for optimistic concurrency and appends a new review.
This extends the existing single-step Undo without changing its semantics.

Existing unsaved edits retain the normal discard confirmation. A guarded
continuation checks clip selection, saved version, history opening and refresh
intent before the confirmation can clear any draft, and again before loading.
Later edits, navigation, writes, closed panels or replacement history reads revoke
it. Form fields and time notes are copied without sharing mutable history state;
zero values and exact positions survive, while null values clear prior fields.
The loaded values participate in ordinary unsaved-change protection and remain
editable after a failed Save. A reported version conflict cannot overwrite the
newer server record.

Current or identical saved content is not offered as a redundant load. History
that exposes a newer server revision disables loading and asks for a workspace
refresh. Invalid or incompatible records cannot partly replace a draft; unreadable
clips still permit valid pending/fix/exclude reviews without scores or time
notes. Note and marker length validation counts Unicode code points, matching
the backend rather than rejecting otherwise valid emoji-rich history.

Verification for this round:

- All 615 Node tests passed, including 29 new actual-function behavioral cases.
  The new harness uses the real marker editor and Save logic with controlled
  DOM and I/O. It covers no-write loading, exact fields and copies, explicit
  current-version Save, failures/conflicts, discard cancel/accept, stale ownership,
  duplicate clicks, both languages, card order/details, safe text rendering,
  newer server history, unreadable clips and Unicode limits. All 18 existing
  history-continuity checks remain intact; their DOM double only gained nested
  elements and the native operations used by the new cards.
- Against the exact restored pre-change repository at
  `be0f0e595833beb94f333f5b42ab92b040cdb012`, the new suite produced 24
  assertion failures and five compatibility passes. Its only missing-feature
  fallback is a no-op loader. There were no fixture ReferenceError, TypeError,
  SyntaxError or cancelled tests.
- Removing only the confirmation ownership guard from the fixed code produced
  eight expected failures and 21 passes. Restoring only UTF-16 length counting
  produced one Unicode failure and 28 passes. Independent review found and
  verified the Unicode correction, with no remaining blocking race or data loss.
- Initial Python checks caught five new Chinese interface characters missing
  from the coverage record. Every existing font hash and size, including the
  unchanged official MiSans hash, was checked before verifying all recorded and
  new characters against its actual cmap. Only the coverage list changed; no
  font binary was rebuilt or replaced. Initial failing logs are retained.
- Python 3.12.14 and 3.13.5 each passed all 134 tests. A fresh wheel matched
  all 88 static assets byte-for-byte and passed all 134 tests after independent
  normal installation. JavaScript syntax, HTML/ARIA references, documentation
  links and `git diff --check` passed.

The full pre-edit repository backup was restored and compared against all
604 regular files; Git integrity and exact HEAD checks passed. The new card
layout, focus and pointer behavior have not been accepted in a real browser.
No browser retry, remote write, version change or publication was attempted.

## Same-tab reload draft recovery

Unsaved review edits now keep one best-effort session-storage copy for the
current workspace in this tab and origin. The recovery panel is separate from
saved-review status and never restores automatically. Restore loads an unsaved
editor only; only the existing explicit Save writes review history. The copy
contains allowlisted review fields, a hashed workspace/item identity and the
complete original saved-review baseline, not source paths, audio or a write
token. It is excluded from workspace backup and export. Closing the tab,
clearing storage or changing the address is outside the recovery guarantee.

Capturing does not parse numeric strings, sort live marker rows, trim pending
text or silently apply/add a time note. Unfinished new markers and inline marker
editing retain their separate raw state. Native number inputs can hide partial
text from JavaScript; those edits remain dirty but visibly unprotected, while
any older readable copy remains available. Recovery never claims to store text
that the browser has not exposed. Successful writes and deletes are read back
before the panel reports success. Malformed or oversized data, storage denials,
quota failures and failed deletes fail visibly without replacing live input.

An earlier pending copy is never overwritten by new live edits. Restore requires
matching workspace, item, review version and complete canonical saved content,
plus compatibility with the current audio. Missing, changed or incompatible
items remain available as a text-only copyable preview. Restoring over dirty
work requires confirmation; selection, refresh, history, version or compatibility
changes revoke that continuation before it can replace any field. The discard
question does not reset the live form before the final atomic marker preflight.
Confirmed Save or accepted ordinary discard clears only an owned copy. Failed or
uncertain writes retain it; clearing the copy never changes live edits or
immediately creates another copy. Returning from the page cache only refreshes
status and cannot reapply an old draft.

Verification for this round:

- All 825 Node tests passed. The 210 new cases cover strict serialization,
  malformed/accessor data, privacy allowlisting, limits and storage failures;
  marker editor snapshots; coordinator ownership and races; and 57 actual
  workbench-function cases using the real marker, storage and Save modules.
  These use deterministic DOM, storage, media and network doubles, not native
  browser reload, page-cache or visual acceptance.
- Independent source audit found that native trim inputs are associated with
  the form through `form=`, but are not descendants. A simulated form had hidden
  that difference. The corrected fixture reproduced a lost dirty state for
  incomplete number text matching an empty saved value. Explicit checks now
  include all three numeric controls, and two additional regressions prove an
  older owned copy and discard-cancellation protection survive. The final six
  focused numeric-input cases also passed independently.
- Six intentional mutations independently remove baseline identity,
  compatibility preflight, hidden-number capture protection, storage write
  verification, missing-source panel refresh and associated-input dirty
  detection. They produce respectively 12, four, six, one, one and three
  assertion failures, with no cancelled or fixture-runtime-error cases. The
  corrected DOM's pre-fix failure is retained in the verification package.
- Python 3.12.14 and 3.13.5 each passed all 134 tests. A fresh wheel matched
  all 90 static assets byte-for-byte and passed all 134 tests after normal
  installation. The server dependency traversal includes both new modules.
  JavaScript syntax, compilation, HTML/ARIA references, documentation links
  and `git diff --check` passed.
- Nineteen new Chinese interface characters were verified against the actual
  unchanged MiSans character map. All font byte sizes and hashes are unchanged;
  only the recorded coverage list changed.

The full pre-edit repository backup was restored and compared against all
624 regular files, including Git history, and exact HEAD/Git integrity checks
passed. No browser retry, remote write, version change or publication was
attempted. Real browser storage, partial-number editing, focus, narrow layouts,
assistive technology and listening acceptance remain unverified.

## Quiet draft protection and keyboard continuity

A normally protected live draft no longer inserts the full recovery card before
its clip heading, player and review form. It appears as a compact native details
disclosure beside the existing saved/unsaved state. Opening it exposes the same
session-only scope, timestamp and Clear action. The reserved heading height and
out-of-flow disclosure avoid introducing a second always-expanded status block.
Pending recovery choices, stale or missing sources, incompatible copies and
storage errors retain the full action panel and copyable preview. Saved review
status remains distinct; this does not change storage or restore semantics.

The short protection label and unsaved status are updated only when their text
changes, not on every keystroke. The timestamp remains outside the live status.
Escape closes an open disclosure and returns to its summary without consuming
IME composition. Outside clicks and keyboard focus leaving it close it without
moving the user's focus. Existing theme variables, focus indicators and native
keyboard controls are retained, with no new animation.

Clearing a copy moves focus only if that disappearing action still owns it:
back to the note editor, or library search when no clip is selected. If clearing
from the compact disclosure fails, its focused action moves to the now-visible
full-panel retry. A failed full-panel clear retains its existing focus. These
operations do not clear live edits or immediately recreate a copy.

Independent review found another related path: Ctrl/Cmd+Enter can save while
the disclosure itself has focus. A confirmed save removes the copy and hides
the disclosure, so the existing save-focus policy now falls back to the editor
instead of a hidden summary. The prior ownership guard still prevents stealing
newer focus, including when the newer target later blurs.

Verification for this round:

- All 850 Node tests passed, including 25 new hierarchy, disclosure, live-text,
  focus, failure and static-markup cases. The complete 82-test reload-workbench
  suite also passed independently. The DOM double now models hidden ancestors,
  disabled-control blur and focus-in ownership, while using actual save,
  recovery, serialization and marker code.
- The same 82 tests against the preceding committed workbench produced 18
  expected assertion failures and 64 compatibility passes, with no cancelled
  tests or fixture runtime errors. Additional targeted mutations check panel
  separation, Clear focus, keyboard-save focus and live-text deduplication;
  their complete intentional-failure logs are in the maintenance package.
- Python 3.12.14 and 3.13.5 each passed all 134 tests. A fresh installed wheel
  passed all 134 tests and matched all 90 static assets byte-for-byte. JavaScript
  syntax, Python compilation, documentation links, 197 HTML IDs and 48 local
  references, and `git diff --check` passed. Font files and coverage records
  were unchanged.

The complete pre-change repository backup was extracted and all 669 regular
files matched their hashes; exact HEAD and Git integrity checks passed. The
layout and focus results above are source/controlled-event checks, not measured
native-browser focus, layout, assistive-technology speech or visual acceptance.
No browser restriction retry, remote write, publication or version change was
attempted.

## Documentation scope

Current design and font notes now describe the acoustic-ring tour, working
listening examples and workspace styles already introduced in 0.13.0. Earlier
note geometry and artwork remain identified as historical. The Chinese and
English entrypoints distinguish 0.13.0 verification from this unreleased
maintenance record; no versioned release notes or application assets changed.

Three documentation tests check maintenance links, local link targets and
Markdown anchors, retention of historical verification links, active tour
module references and the declared tour font family. All three and the full
326-test Node suite passed. These are source/documentation checks, not browser
rendering or visual acceptance.

## Saved annotation context in search results

Saved review-note and time-note matches now show a bounded original-text excerpt
inside the existing queue-selection button, with the note source and exact
millisecond timestamp where applicable. This distinguishes identical filenames
without opening each review. The default queue and identity-only matches stay
compact. Context never reads unsaved forms, adds storage or network requests,
changes filter semantics, automatically seeks audio or adds nested controls.
Text uses `textContent`, not HTML. An excerpt is limited to 100 Unicode codepoints
and starts at a matching grapheme so short late matches are not hidden behind
unrelated leading text. NFKC and locale-aware case normalization remain shared
with search; complete normalized ranges reject false raw matches inside
combining characters or contextual Greek case folding. Missing grapheme support
uses a source-only ellipsis when safe cropping is unavailable.

Forty-four new pure-logic tests and seventeen new actual-handler DOM-model tests
cover safe text, source isolation, normalization, bounds, deterministic source
choice, cache invalidation, equivalent-query reuse, fresh catalog snapshots,
status filters, sorting, batch scope, dirty fields and composition input. Both
contextual and compact rows use their measured height for selection highlighting;
CSS specifies matching intrinsic heights. These checks do not measure browser
layout, input-method behavior on a real OS or assistive-technology output.

Negative controls on temporary copies produced three assertion failures against
the previous renderer, two without context cache invalidation, three without
normalized-anchor validation, eight with leading-prefix excerpts, and one with
an unchecked short-text return. No control failed from syntax or missing fixtures.
An independent boundary script passed 19 cases and an independent related-suite
run passed 118 tests after the Unicode fixes.

A synthetic Node benchmark processed 1,000 notes of 4,000 codepoints each with a
match near the end. Three runs of context extraction took 6.04–7.51 ms for ASCII,
52.67–55.32 ms for Chinese literal matches, 151.06–156.22 ms for NFKC expansions,
and 139.66–142.77 ms for combining-character matches. All excerpts contained the
correct match and met the bound. Special normalization paths still incur about
150 ms of synchronous work at that scale; these are Node observations, not
browser responsiveness or frame-rate claims.

The pre-change backup restored all 685 repository files, including Git history,
and matched the prior commit. The final wheel retained all 90 static assets.
Browser acceptance and remote publication remain blocked as described below.

## Preserving quick-import recovery scope

Quick file, folder and manifest actions send an append request. Previously, an
error opened the manual dialog with its last checkbox value, so a previous
replacement choice could turn a retry of the same addition into replacement.
If the native picker failed before returning a path, the dialog also inherited
an unrelated earlier path. Replacement deactivates previous catalog entries;
it does not delete original audio or saved history.

The quick-action error path now explicitly selects append before showing the
manual recovery dialog. It keeps a newly selected path, but clears an unrelated
old path if no new selection was obtained. Manual browsing preserves explicitly
chosen replacement mode and typed paths. Native picker cancellation and refused
draft-discard confirmation leave those fields unchanged. Users may still choose
replacement after recovery; no import write is retried automatically.

Fifteen new deterministic tests execute the production import, browse, dialog
and Cancel handlers. They cover all three source kinds, picker failure, selected
paths, inline errors and focus, cancellations, manual replacement, successful
quick imports, explicit changes after fallback, repeated failure and exactly one
write per explicit submit. The previous source fails seven of these cases.
Targeted mutations independently check stale mode, stale path, unwanted manual
reset and forced append behavior. All failures are assertions, not test harness
errors. A separate real Workspace-method check using generated temporary WAVs
confirmed append keeps both clips active, replacement deactivates the old
entry, and both original audio hashes and review history remain intact. No user
material was used.

The pre-change backup restored all 704 repository files and Git history. This is
source and deterministic request/DOM verification, not a real native picker,
browser focus or OS-dialog acceptance run.

## Current-record command activation

The command palette can remain open while a background import completes and
refreshes the library. Its cached audio commands previously captured old item
objects. Activating one could restore an older review/version into the clean
editor, or select a clip removed from the current catalog. Production-handler
simulation reproduced both cases using actual command rendering, job completion,
refresh and selection code. Backend active-item and version checks remain in
place; this evidence does not demonstrate persistent data loss.

Audio commands now resolve their key against the current catalog at activation.
A current item uses the existing selection flow; an absent item shows a localized
notice without asking to discard the current draft or changing media, waveform,
listening position or session storage. Busy operations retain their existing
feedback. The visible command list itself is still rebuilt on opening or input;
execution-time validation is what prevents stale object reuse.

Sixteen new tests cover mouse and Enter activation, exact current-object identity,
clean and dirty removed-item handling, busy behavior, cancelled and accepted
discard, and newer navigation/refresh ownership. Additional controlled internal
interleavings exposed a pre-existing ordering gap: select checked its navigation
intent only after discardAllowed had already cleared the draft. Passing the same
intent/busy guard into discardAllowed now prevents that earlier side effect.
These internal interleavings verify defensive ownership; ordinary user
reachability through the native modal dialog has not been demonstrated.

Negative controls use isolated older or mutated source files and assert failures
for old-object selection, missing-item fallback, unguarded draft discard and
busy feedback ownership. The current full suite and the new focused suite pass.
The pre-change full backup restored 717 files and Git history. The new Chinese
message was checked against the existing MiSans font cmap without changing fonts.
These are source and deterministic DOM/I/O checks, not native browser, focus or
screen-reader acceptance.

## Analysis source consistency follow-up (2026-11-04)

Analysis now compares the original-file SHA-256 again after decoding, in addition
to the size/mtime checks before and after the final hash. A persistent replacement
with different bytes is rejected even when it preserves the source's byte count
and nanosecond modification time. No decoded result is returned on a mismatch,
read failure or cancellation. Existing result fields and normal decoding behavior
are unchanged.

The extra verification reads the entire source once more and computes another
SHA-256; this increases I/O and hashing cost, particularly for large files or slow
storage, without copying the source or retaining its contents in memory. The
cancellable path continues checking around bounded 1 MiB reads. A blocking file
read cannot be interrupted by the callback until it returns.

This is detection, not an atomic snapshot or a lock on external writers. Changes
that are reverted between observations, or occur after the final observation,
can still escape these checks. Keep sources stable during analysis and rescan
after edits. This change does not promise to prevent all concurrent-write races.

Verification on generated temporary sources:

- Six new deterministic regressions cover same-size/timestamp-preserved replacement
  before and after decoding, unchanged results with and without cancellation checks,
  cancellation during the final real-file hash with stream closure, final hash read
  errors, and metadata changes during that hash.
- The two replacement tests fail against the restored pre-change source (three
  failing cases including the cancellable variant) and pass with the fix.
- All 27 focused audio/consistency/cancellation tests pass, including the available
  FFmpeg WAV/FLAC/MP3 checks and existing sample-width/multichannel coverage.
- All 162 non-server Python tests pass with socket creation blocked and zero socket
  attempts. The separate in-memory server adapter passes 23 tests and 176 requests,
  also with zero socket attempts. All 1,355 Node tests pass; `git diff --check` passes.
- No live server, external network, real user audio, push or deployment was used.
  These checks do not verify live HTTP transport or native browser behavior.

## CSV syntax validation follow-up (2026-11-04)

CSV manifests now use the standard library parser's strict mode. Unterminated
quoted fields and unexpected characters after a closing quote are rejected as
readable validation errors with the failing physical line number, including when
the error occurs after valid rows. Parsing finishes before ingestion starts.

- Four new regression tests cover late malformed rows in replacement/append
  modes, malformed headers, CLI status 2 without success output, and unchanged
  active catalog, import source, saved review history and logical database dump.
- Valid UTF-8 with/without BOM, Unicode paths, quoted commas, doubled quotes and
  LF/CRLF multiline labels remain supported.
- Against the restored pre-change source, the new suite produces six expected
  failing cases; the valid-input test still passes. The fixed suite passes.
- All 166 non-server Python tests pass with socket creation blocked and zero
  attempts. The separate in-memory server adapter passes 23 tests and 176
  requests, also with zero socket attempts. All 1,377 Node tests pass.
- `git diff --check` passes. Only generated temporary audio/workspaces were used;
  no live server, external network, user data, push or deployment was used.

This is CSV parser strictness, not a new manifest schema or a universal CSV
linter. It does not add column-count/header validation. Live HTTP transport and
native browser behavior were not tested in this follow-up.

## CSV ambiguity validation follow-up (2026-11-04)

Duplicate nonempty header names and rows with surplus cells now fail before
ingestion, with the physical line where the header/row ends. Surplus empty
trailing cells also fail. This intentionally rejects files where earlier versions
silently selected the last duplicate value or discarded extra cells. Unknown
uniquely named columns remain accepted and ignored. Missing optional trailing
cells now behave as omitted columns, including the default `eligible=true`;
explicitly empty eligibility values remain invalid. This is not full schema
validation: no new required-header or unknown-column restrictions were added.

- Five added tests cover duplicate standard/unknown/multiline headers, late
  surplus cells in replacement/append modes, CLI status 2, logical database,
  catalog, import-source and history preservation, allowed named extras/quoted
  commas/BOM/optional omissions, and explicit empty eligibility rejection.
- The existing cancellation test now supplies header metadata in its reader
  double; cancellation still prevents ingestion and preserves saved work.
- Against the restored pre-change source, the nine-test CSV suite has 12 expected
  failing subcases plus the expected omitted-eligibility error; the fixed suite
  passes. Existing strict syntax and valid quoting tests still pass.
- All 171 non-server Python tests pass with socket creation blocked and zero
  attempts. The separate in-memory adapter passes 23 server tests and 176
  requests with zero socket attempts. All 1,377 Node tests pass.
- Python compilation and `git diff --check` pass. All audio and workspaces are
  generated temporary fixtures. No live server, external network, user data,
  push or deployment was used; live HTTP/browser behavior remains unverified.

## JSON duplicate-property follow-up (2026-11-05)

Manifest parsing now rejects repeated property names within any JSON object,
including nested unknown metadata, before ingestion. The parser's object-pairs
hook compares decoded property names, so escape-equivalent names also collide.
Unknown unique properties and the same name in separate objects remain valid.
Previously accepted duplicate-property manifests must be disambiguated explicitly;
the app no longer silently chooses the last value. Errors name the duplicate
property and map to the existing `manifest_format` UI category. Cancellation is
checked during object construction as well as around parsing.

- Six new tests cover duplicate path/id/schema/items, nested/empty/escaped-equivalent
  property names, replacement and append, late failure without ingestion or
  catalog/settings/history/logical-database mutation, CLI status 2, background-job
  error mapping, valid Unicode/BOM/unique extras/defaults, and cancellation.
- Four selected tests against the restored pre-change source produce 16 expected
  failing cases; the valid-input test passes. The fixed six-test suite passes.
- All 195 non-server Python tests pass with socket creation blocked and zero
  attempts. The separate in-memory server adapter passes 24 tests and 181
  requests, also with zero socket attempts. All 1,434 Node tests pass.
- Python compilation and `git diff --check` pass. Only generated temporary audio
  and workspaces were used; no live server, external network, user data, push or
  deployment was used.

This tightening applies only to JSON manifest imports, not review restore or
other JSON inputs. It does not add full JSON/schema validation, change nonfinite
number parsing, or provide duplicate-property line/column locations. Parsing is
not interruptible during every token scan; cancellation is observed at hook and
existing surrounding checkpoints. Live HTTP transport and native browser behavior
remain unverified.

## Restore/request JSON duplicate-property follow-up (2026-11-05)

The duplicate-safe object-pairs parser is now shared by manifest import, CLI
review restore and HTTP JSON request parsing. Manifest error text and cancellation
checkpoints remain intact. CLI restore duplicates fail with status 2 before any
review is restored; accepted HTTP JSON endpoints reject duplicates with status
422 and the existing `review_invalid` UI category before dispatch. The rejection
includes nested markers and otherwise ignored metadata. Older last-value-wins
inputs must be disambiguated explicitly.

- Six new tests cover duplicate restore status/key/review/items and nested marker
  fields; HTTP review and batch duplicates; exact logical database, catalog,
  import-source and history preservation; valid legacy restore with omitted
  markers, Unicode/BOM and unique extras; normal review/batch requests; malformed
  syntax/encoding/non-object input; and body limit/auth/content-type gates.
- HTTP regressions run the real handler through the existing in-memory adapter,
  without a listener or socket. Existing manifest cancellation and error tests
  also pass after the loader refactor.
- Four selected tests against the restored pre-change source produce 13 expected
  failing subcases, while normal restore and request tests pass.
- All 201 non-server Python tests pass with socket creation blocked and zero
  attempts (including the new in-memory request regressions). The separate server
  adapter passes 24 tests and 181 requests, also with zero socket attempts. All
  1,434 Node tests pass. Compilation and `git diff --check` pass.

This is duplicate-property rejection, not comprehensive JSON/schema validation.
It does not change the 128 KiB HTTP body limit, preparse security gates, encoding
support, nonfinite-number parsing, timeout or Content-Length framing behavior.
CLI restore still reads its full file and has no new cancellation interface;
manifest cancellation retains its existing checkpoints. Parsed Python dictionaries
cannot retain duplicate keys, so direct dictionary-based workspace APIs are
unchanged. No real user data, live server, external network, push or deployment
was used. Live TCP, browser and slow-client behavior remain unverified.

## Checks run

- Python 3.12.14 and 3.13.5: 134 tests passed on each, including available FFmpeg checks.
- Node.js 24.22.1: 942 tests passed, including batch recovery, waveform recovery, save/continue focus, undo recovery, review history, import progress, note navigation, workspace detection, reference timing, media transitions, static accessibility,
  download-link and trim precision checks.
- CLI generated demo and JSON export: passed.
- Python compilation, JavaScript syntax and `git diff --check`: passed.
- Static HTML IDs, internal anchors and accessible-description references: passed.
- A wheel built from a fresh source copy contains byte-identical versions of all
  90 static assets. After normal local installation, all 134 Python tests passed,
  including 23 server tests and the workbench dependency graph. Direct ZIP-import execution is not
  supported by the website's file-serving paths; use a normal installation.
- Full pre-change repository backups were verified, extracted and checked for
  recovery, including Git history and the first-round uncommitted fix.

## Not verified

Chromium could not start in the cloud test environment. It exited after
`socket()` returned `Operation not permitted`, including on the approved elevated
attempt. No browser screenshots, visual acceptance, listening assessment,
real-screen-reader results or frame-rate measurements are claimed for this work.

Before release, run browser checks for both languages and themes, narrow and
wide viewports, keyboard focus, reduced motion, A/B playback, trim controls,
dialogs and save/continue. Windows/macOS, Python 3.11 and the remote CI matrix
also remain to be checked for the final published commit.

### Unverified primary audio binding (2026-11-05, local candidate)

- Missing/unreadable A without an expected digest now blocks review saves, undo, batch writes, entire JSON/CSV exports (including status-filtered CSV), and restoration of historical decisions. Later-appearing bytes do not certify the old version.
- Import checks active and inactive same-key rows inside its transaction and rejects changing the path of an unbound primary. Healthy and hash-bound corrupt primary keys remain compatible. A successfully analyzed digest survives later B/interval failure without hashing replacement bytes into that record.
- Eight focused synthetic-workspace tests cover missing→appearing A, active/inactive path collision rollback, B transitions, legacy healthy/corrupt keys, exact-byte restore, mixed export/batch/restore atomicity, cancellation and error mapping. Against the restored pre-change source, these regressions reported five failures and two errors; all pass against the candidate. Two JS cases check Chinese/English recovery guidance, and a handler case verifies HTTP 409/error codes without mutation.
- Offline verification: 189 non-server Python tests, 1,414 JavaScript tests, and 24 in-memory handler tests (181 memory requests, zero socket attempts). The existing handler adapter checks request parsing and response behavior only; live TCP/listening, browser and transport races were not tested. System Python verified shipped font hashes and glyph coverage without altering font bytes or the coverage manifest.
- All fixtures use generated audio and disposable workspaces. No user workspace, network, live server, push or deployment was used. Recovery guidance documents whole-workspace backup, separate-copy subset exports and explicit reimport/review; historical records are not silently migrated.

### Restore cleanup outcome (2026-11-05, local candidate)

- Restore now explicitly owns and cleans only its own `ard-review-validate-*` directory. Cleanup errors warn without replacing a confirmed successful count or the original validation/transaction failure. The warning contains the generated directory basename and outcome guidance, not the temporary parent, source paths, database contents or raw cleanup exception. Failed warning writes do not replace the result.
- Success is confirmed only after normal exit from the database contexts. Interrupts propagate. Commit/close errors can remain uncertain even if a transaction committed; this change does not promise exactly-once restore or add rollback/retry. A repeated restore intentionally appends history. Users must inspect reviews/history when the outcome is uncertain and must not retry a confirmed restore just to clear a cleanup warning.
- Twelve deterministic tests exercise the production CLI/restore path with disposable generated-audio workspaces: committed cleanup failure without retry duplication; validation error plus cleanup failure and corrected retry; precommit conflict and backup failure; uncertain post-commit exit; ordinary and zero-row restores; orphan identification and warning privacy; unrelated-directory protection; validation/cleanup interrupts; broken diagnostic output; missing-copy cleanup errors; and temporary-directory creation failure. An initial test used the wrong database filename; the corrected fixture passes without weakening production behavior.
- Final Python 3.12.14 verification: all 217 tests outside the live server/tour-route suites passed with socket creation blocked (zero attempts). The existing in-memory handler adapter separately passed 24 tests and 181 memory requests, with zero socket attempts and no remaining fake origins. All 12 focused tests also passed independently. `git diff --check` passed. No JavaScript was changed or rerun for this change.
- The full pre-edit worktree backup was restored and compared before implementation. No real user files, network, listener, push or deployment were used. Native Windows sharing behavior, forced termination, power-loss durability and browser acceptance remain unverified. Cleanup failure can leave a private copy of the entire review database; the manifest guide documents locating and positively identifying it before manual removal, without sweeping other operations' directories.
