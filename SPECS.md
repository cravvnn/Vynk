# State model coverage

Models use the pinned development-only tla-ts checker. Run `npm run check:tla`.
Each bounded model names its callers, assumptions, and exclusions beside its code.
Passing a model proves only the listed rules inside those bounds.
The runner normalizes source line endings before applying guard mutations; its
own regression checks LF/CRLF files through absolute and relative CLI paths.

| Component | State and risk | Model / status |
| --- | --- | --- |
| `tools/ae-pair/run.mjs` shutdown | Launch ownership, graceful close, timeout records; closing unrelated work or forcing a crash | `tools/ae-pair/Shutdown.tla`: two hosts, process ownership and disposable-project guards, exit or refusal, timeout; four guard mutants. `--fresh` reuses those ownership/path predicates for disposable baseline close; file creation/copy wait and command transport are exercised by the real-AE harness and are not modeled here. The focus helper only repeats an idempotent request at most three times and retains no state across calls; physical focus remains an external nondeterministic input to Styles. |
| `tools/ae-pair/host-process.mjs` process attribution | Two stable releases both named AfterFX.exe being treated as the same host, duplicate instances or unreadable executable paths | `HostProcesses.tla`: two executable paths, a duplicate process and unreadable metadata; 64 states, three guard mutants. Direct tests check enumeration order, path case/slashes, disappearance/replacement and pair configuration, and execute the Windows helper rejection paths. Startup rejects existing AE processes; host commands require a fresh executable/recorded-PID match, focus/dialog helpers recheck that executable plus PID, and shutdown retains saved executable paths. Successful window activation/dialog handling, PID reuse after inspection and end-to-end host routing remain real-AE gates. |
| `tools/ae-pair/run-script.mjs` bootstrap | A late panel consuming the same mutation after a command-line fallback; retrying an already executed mutation after its reply times out | `ScriptBootstrap.tla`: readiness success/failure, uncertain completion and late command delivery; 6 states, two mutants. The queued readiness probe is read-only, and a posted mutation never falls back. Unit tests exercise orchestration and refusal to close unrelated projects. A just-opened converted fixture is saved at its exact disposable path. Startup waits for an AE main-window class; shutdown waits through unreadable exiting-process metadata without treating it as ownership or proof of exit. Successful cold startup has run on modified development hosts; OS routing and panel lifetime need official-host checks. |
| `tools/ae-pair/png.mjs` render receipt | AE returning before a frame file is complete, or reusing a previous attempt's pixels | A unique path identifies each render attempt. Read-only bounded polling accepts only a successfully decoded PNG from that path. Direct tests cover missing, partial and stale output; no project/protocol state changes. Actual rendered pixels remain a host gate. |
| `panel/src/main.js` room lifecycle | Current socket, delayed callbacks, offline room ownership; edits reaching the wrong room or a replacement being disconnected | `panel/src/Session.tla`: two sockets and two rooms, hello/welcome/close interleavings, queued room edit, abstract relay delivery and host consumption; four mutants. 757 states to depth 11. Queue retention now follows Delivery's ACK contract. |
| `panel/src/main.js` asynchronous requests | Delayed HTTP, AE and native callbacks after a new connection/project; wrong data or clearing a replacement's busy flag | `Requests.tla`: two requests and a context change, 31 states to depth 6, two mutants. HTTP context reuses socket/shadow-object/path identity; resetting a project also advances the existing pollGeneration and schedules a fresh cycle. |
| `panel/src/main.js` HTTP transfer completion | Truncated response hanging or accepted as a base/history file, duplicate callbacks | `Transfers.tla`: buffered response and file-stream configurations (5/8 states), two mutants; termination, one callback, no partial success. Real HTTP abortion/byte tests also run on Node 8.6. |
| `panel/src/main.js` delivery | Local edit, durable queue, lost frame/echo, one reconnect, relay retry | `Delivery.tla`: two editors, one edit each, two attempts; 8,281 states to depth 25, three mutants. `Acknowledgements.tla`: two successive edits to one field, duplicate echo; 13 states, one mutant. `Pacing.tla`: bounded send-window abstraction, 1,245 states, one mutant; actual 450-edit timed relay test also runs. |
| `panel/src/main.js` replay order | Accepted own receipt releasing protection before older replay; live edits overtaking an HTTP history fetch; premature repair | `Replay.tla`: 164 states, five mutants; one accepted scalar/structural batch, older/later scalar edits, a disjoint field, optional unaccepted local intent and one live edit. Ordered replay skips earlier values superseded by a seen exact target, skips the seen batch itself, stages live entries behind the missing prefix, and holds repair until replay is planned and applied. Assumes successful atomic FIFO host apply; structural conflicts, setter side effects and seen-ID eviction remain outside the model. |
| `server/src/index.ts` expired log with retained base | Restart assigning new edits at sequences already covered by the snapshot, hiding them from late joiners | `RetainedBase.tla`: base at seq 2, a retained/expired log and one later append; one mutant. The base is a lower bound for new sequence allocation. Edits lost after the base remain unrecoverable by this rule. |
| `panel/src/main.js`, `server/src/index.ts` reconnect anchor | A newer base omitting a deletion still missing from an existing project; a changed project inheriting old replay; false holds during socket replacement | `Resume.tla`: 90 states, five mutants; missed removal, disjoint offline value, new base before/during welcome, project/token changes and another reconnect. The context binds an in-memory project and room generation to its original replay prefix. Transport replacement waits for welcome; an actual project replacement keeps its hold across that welcome. Reload, native apply failures and structural conflict resolution remain separate gates. |
| `server/src/index.ts` room generation | Publishing before a failed token write; expiry replacing an active retained generation | `RoomToken.tla`: 48 states, three mutants; token write success/failure and one join racing a sweep. New token rename must succeed before publishing, fresh state retains its token, and per-room sweep/join reservations exclude each other. Assumes one server process and an atomic filesystem success/failure interface. |
| `server/src/index.ts` log recovery | Acknowledging a successful append concatenated into a partial last line; read errors resetting sequence allocation | `LogRecovery.tla`: corrupt/incomplete/no-newline/duplicate-sequence tail or read error, one join and append; two mutants. Unsafe logs refuse joins without rewriting the file. Real private-relay regressions include a valid 55 MB tail read. Does not prove recovery from power loss or repair damaged data. |
| `panel/src/main.js` saved base capture | Observed revision/prefix, posted save, immutable file copy, edits or saves during upload | `BaseCapture.tla`: one later edit or project switch, save/copy as one host step; 32 states, four mutants. Assumes the sync engine supplies a fully observed applied prefix after a quiet read round. Actual AE save/copy semantics remain a runtime gate. |
| `panel/src/main.js` base replacement | Confirmation, guarded posted open, socket close, stale seen IDs, changed shared base, fresh welcome | `BaseOpen.tla`: 58 states, eight mutants; affirmative confirmation is required, new edits or a different project cannot be overwritten, an already-posted open survives socket/base changes, new history is replayed only onto the matching downloaded checkpoint. Excludes manual panel reload during a native call and native modal dialogs. |
| `panel/jsx/sync.jsx` local base view | A shared file overwriting the recipient's playheads during base open | `BaseView.tla`: four states, three mutants; one atomic open/restore, comp order changes, one local seek and a new comp. Existing times restore by SID, new comps start at zero; no time enters relay ops. Real native setter failures are counted instead of disguising an already-completed open as cancellation. |
| `panel/jsx/sync.jsx` style result | An ignored removal acknowledged as success; unregistered cold Beta menu commands | `Styles.tla`: one requested removal, lazy command registration and a successful/ignored menu result; two mutants. An acknowledged set must be exact; supported commands complete after registration. Numeric IDs, focus and eventual retry after an ignored command remain real-AE gates. Direct engine tests use 3739 to initialize and 3744 to remove styles while retaining unrelated effects. |
| `panel/src/main.js` custom-data phase | A native write overwritten by host effect reconstruction; stale parameter ordinals; ignored created-control failures | `CustomData.tla`: one effect reconstruction, native whole-value write and read; 4 states, one ordering mutant. Existing and created controls use the same post-host phase. Direct panel regressions check fresh positions, native errors, missing companion, timeout and incomplete reads. |
| `aegp/src/AeHost.cpp` custom-data writes | Deleting keys before validation, a failed/silently ignored setter reported as success, incomplete restoration | `ArbWrite.tla`: payload/layout compatibility, setter and verification results, restoration success/failure; 70 states, five mutants. Rejected inputs remain unchanged; success requires verified data; SDK failures remain errors even when rollback fails. The native codec has no persistent state and is tested without the AE SDK in CI. Real handles, undo, layer-time conversion and effect formats are two-AE gates. |
| `aegp/src/AeHost.cpp` legacy identity / `panel/jsx/sync.jsx` | Independently stamping a shared base before AE22, addressing a stale native layer, losing applied-prefix receipts on refresh failure | `NativeIdentity.tla`: two project generations, target present/absent, main-thread capture/apply/release, refresh success/failure; 32 states, four mutants. Tables are command-local. Mocked production JSX checks base IDs, comment stamps, aliases, duplicate stamps, reorder/delete/replacement, new-layer refresh and failure before mutation. Native Release builds and CTest pass with official Windows SDKs 25.2/25.6/26.5/27.0. Twenty-four Curves/Pattern/identity cases pass on modified development hosts 25.6/26.3, with native identity during animated Curves; nine additional cases enable it before Pattern. Both runs have diff0 and clean health. C++ tests cover allocated empty script-error handles and release on error/lock failure. Official-host execution, persistence across reopen, a complete full pair pass and real AE2020 remain required host gates. |
| `panel/src/main.js` remaining sync | Snapshot contents, repair, storage exhaustion, queue scope and native writes already dispatched | Remaining state coverage is incomplete. Direct panel tests cover room-token/project binding and storage/capacity failure across reload; these paths are not yet composed into Delivery. Request-method and history validation defects reproduce in one call and have direct regressions. The asynchronous model checks callback ownership, not AE/native execution after dispatch. |
| `panel/src/main.js` observation / repair | Repeated item upserts forgetting an observed comp, first remote read delayed past a local edit, and repair deleting an unmatched peer layer | `Observation.tla`: one scalar/layer, upsert and local edit; three mutants. Existing comp baselines survive announcements, new remote comps are read in the apply call, and repair never deletes peer-only layers. Host read failure, reload bootstrap and arbitrary structural conflicts remain outside the model. |
| `panel/src/main.js` full repair response | Equal layer hashes hiding different order or composition settings | `RepairOrder.tla`: a quiet requester/reference, one full response and successful host apply; one mutant. Order and settings are included before testing whether the response is empty. Delivery covers transport; arbitrary structural conflicts remain outside this model. |
| `panel/jsx/sync.jsx` | AE identity stamps, project reads, atomic remote applies, pending style changes | Not yet modeled; checked by real-AE convergence scenarios. |
| `server/src/index.ts`, `recovery.ts` delivery | Ordered append before echo, last-peer drain, pending-ID proof beyond memory, concurrent commits | `Append.tla`: two queued writes, last-peer close, one new join, write success/failure; 188 states, three mutants. `Receipts.tla`: four log entries, one-entry memory window, prefix scan and suffix race; 53/45 states in two configurations, four mutants. A committed surviving record proves its own ID; unknown IDs still require a complete prefix. These supply the committed-log/accepted-ID interfaces assumed by Delivery. |
| `server/src/index.ts` base commit | Snapshot prefix during edits/upload/restart, last-peer close, one base writer | `BaseCheckpoint.tla`: 13 states, two mutants; checkpoint persisted with metadata instead of relying on a separately written sidecar. `BaseUpload.tla`: two upload attempts, one leave/rejoin; 43 states, two mutants; reservation and exclusive writer. Real private relay tests cover these races and a failed metadata write. |
| `server/src/index.ts` remaining state | Sessions, base storage, expiry, process shutdown | Coverage remains incomplete; endpoint/integration/soak tests. Append models process-level successful writes, not fsync, power loss, or corrupt partial appends. |
| `aegp/src/Overlay.cpp`, `PluginMain.cpp` window handoff | Cross-instance window binding and worker/main shutdown dependency | `OverlayOwnership.tla` models two AE hosts/window publications (8 states), with two mutants. `OverlayShutdown.tla` models the caption-query/join cycle observed by WCT (6 states), with a mutant restoring the deadlock. HWND destruction/reuse, drawing, and SDK errors are not modeled. |
| `aegp/src/PluginMain.cpp`, `Bridge.cpp`, `AeHost.cpp`, remaining overlay work | Plugin lifecycle, socket queues, native reads/writes and drawing | Remaining state coverage is incomplete; SDK window ownership/shutdown dependency covered above. |
| `panel/src/sync.js`, `shared/protocol/src/index.ts` | Pure diff/adopt/digest functions and types | No persistent state; state belongs to callers. Model behavior through the panel/host/relay interfaces. |

The session model composes one panel lifecycle with abstract relay/host delivery.
Delivery composes two panel queues with an ordered accepted-ID relay interface.
The intended full sync model also includes value-level LWW and serialized AE
apply/read steps. That coverage is not complete yet.

Custom-data simplification removes the separate pre-host write phase and `_arb`
result bookkeeping. Existing and created controls resolve against the fresh host
read and share one write/read phase, without a new pending queue. Layer-time
coordinates remove composition offset/stretch conversion from the native payload;
the comp-time prototype failed on reversed layers during the real-AE gate.
Temporal ease is stored numerically in the ordinary value tree, so the existing
float tolerance prevents echoes from recomputed ease noise. Bytes and rational
key times remain exact. CustomData has four reachable states; the pre-host ordering
mutant loses a reconstructed value in four steps. Pattern artwork preflights are
single-call guards covered directly by host tests; Styles still abstracts only the
menu result/registration contract. An original synthetic PSD and rendered-pixel
comparison check the supported shared-base Pattern Overlay workflow.

Observation simplification removed baseline invalidation on item upserts and the
`agreed`/`fresh` repair-deletion state, with no replacement flags. The baseline
loses a local edit in four steps; the corrected model has 10 states and three
load-bearing mutants. Remote comp creation uses the existing read planner in
the apply call. RepairOrder moves the empty-response check after metadata,
without adding state; its baseline fails in three steps.

Delivery baseline: actual-panel tests failed because a ready WebSocket sent edits
before welcome, a transmitted edit left no durable payload, and a duplicate own
echo decremented a newer edit's pending counter. The candidate uses one queue for
offline and in-flight edits; only an exact queued ID can acknowledge a payload.
Hello advertises at most 500 pending IDs and welcome returns the accepted subset.
The relay proves membership/absence from a contiguous full prefix, merges commits
made during the scan, retains advertised receipts during that connection, and
checks again inside its serial write chain before accepting a retry. A duplicate
gets a receipt without another log entry or a peer broadcast. Normal clients send
each new ID once per connection and advertise unconfirmed IDs on every reconnect;
this is not an unlimited arbitrary-op-ID reuse service.

The old discard-on-send path breaks NoLostEdit in five states; restoring duplicate
commit breaks NoDuplicateCommit in eleven. Simplification removed a separate
unsent-only queue/flush lifetime: queued and transmitted payloads now have the same
ACK lifetime. The two derived bookkeeping variables removed from Delivery did not
change its 8,281 reachable states. Sender pacing was added after a real 450-edit
queue caused a rate-limit reconnect; the same test now drains without reconnecting.
Private-relay regressions also cover a lost echo across relay restart, failed disk
append, last-peer shutdown while appends drain, and receipts older than 5,000 ops.

The scalar stress producer waits for a reloaded frontend's first room welcome,
matching the real host-diff precondition. All incoming frames now have a 100 ms
FIFO delay. The old producer falsely counted edits before that first welcome;
with the delay it recorded only 114 of 120 intents. The corrected producer
preserves all 120 while still dropping frames/echoes, reloading and restarting.
This is test scheduling over Session/Delivery's existing welcome contract, with
no new product state.

Base baseline: the upload-end checkpoint skipped a committed edit made while
older captured bytes were still uploading. Reopening a base retained old seen IDs
and requested no fresh history. The candidate saves/copies under a same-file and
revision guard, uploads the private copy with its captured prefix, and reconnects
to the original session after a guarded open. Expected hash, token and sequence
bind that fresh welcome to the downloaded file. One context-owned job represents
preparing/saving/uploading or downloading/checking/opening; there are no separate
busy flags. It uses the existing bounded background read round, rather than
forcing all comps into one large host request. Room changes are deferred while
the actual native file action is posted; the UI reflects this short barrier.

The relay advertises optional `welcome.checkpoint`, accepts an explicit upload
`seq`, and includes `BaseInfo.seq` with the hash in atomically replaced metadata.
Legacy uploads keep a request-start checkpoint without claiming a verified
snapshot in BaseInfo.seq; current panels request a freshly captured base. The
body and metadata are separate files: a failure between their renames can make
the old base temporarily unavailable by hash mismatch. It cannot be treated as
a verified replacement, and the host must retry. This is not power-loss proof.

Panel tests execute the generated ES3 scripts in a fake AE host with real private
filesystem copies. This proves callback/guard logic and byte immutability under
the fake host contract, not After Effects API behavior. The prepared real-AE
checkpoint/reopen scenario is included in the pair gate but remains unrun.
Private relay/panel tests now cover ordinary reconnect across a newer shared
base, including a missed removal plus a disjoint offline edit. The prepared AE
scenario remains unrun. Panel/AE crash recovery and native actions already
executing during a frontend reload need further end-to-end coverage; these
passing models do not prove those paths.

The old 30-minute relay soak passed transport activity and memory checks before
these delivery changes. It did not prove every intended edit survived, and its
result is not a verification of this later candidate.

The old room lifecycle fails `NoCrossRoomTraffic` after reconnecting to another
room with an old edit in memory. The new design gives every socket callback the
same ownership test and moves connection teardown into `disconnect`, eliminating
the wait for a close event to update UI state. Changing rooms persists the old
outbox under its original key and starts new room state. Four mutants restore
old queue routing, old close handling, old hello handling, and old message handling;
each breaks its named rule. The model initially checked only the mutable active
socket and missed cancellation of a replacement: it now separately retains the
chosen socket so that loss of the replacement cannot make the invariant vacuous.

Shutdown baseline: the old design allows a close request without process/project
ownership evidence after one transition. The simplified design removes force termination
and only removes ownership records after its launched processes exit. It keeps the
existing bounded wait and reports failure rather than adding a second shutdown path.
The bounded default explores 136 states to depth 7; all four mutants fail their
named invariants. This does not prove the operating system or AE will exit on request.

Native window simplification: the old worker searched all windows and sent
`WM_GETTEXT` to AE's own main thread through `GetWindowText`. Two real AE versions
exposed both wrong-instance binding and a shutdown deadlock. Windows Wait Chain
Traversal identified the main AE thread joining its overlay thread, which was
waiting on SendMessage back to the main thread.
The fix replaces the search with the SDK's `AEGP_GetMainHWND` in the main idle
hook and an atomic HWND handoff. UtilitySuite6 was frozen in AE 12.0, before the
AE 2020 minimum. The worker's global enumeration and caption queries are deleted;
ownership/focus checks use process IDs. The shutdown model's original three-step
trace deadlocks; the replacement's six states pass `ShutdownCompletes`.

Model checks and the native build pass. Runtime verification of the replacement
is pending installation/restart; a model pass is not evidence of that verification.
