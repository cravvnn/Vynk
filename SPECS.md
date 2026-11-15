# State model coverage

Models use the pinned development-only tla-ts checker. Run `npm run check:tla`.
Each bounded model names its callers, assumptions, and exclusions beside its code.
Passing a model proves only the listed rules inside those bounds.
The runner normalizes source line endings before applying guard mutations; its
own regression checks LF/CRLF files through absolute and relative CLI paths.

| Component | State and risk | Model / status |
| --- | --- | --- |
| `tools/ae-pair/run.mjs` shutdown | Launch ownership, graceful close, timeout records; closing unrelated work or forcing a crash | `tools/ae-pair/Shutdown.tla`: two hosts, process ownership and disposable-project guards, exit or refusal, timeout; four guard mutants. Startup and command transport are not yet modeled. |
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
| `panel/src/main.js` remaining sync | Snapshot contents, repair, storage exhaustion, queue scope and native writes already dispatched | Remaining state coverage is incomplete. Direct panel tests cover room-token/project binding and storage/capacity failure across reload; these paths are not yet composed into Delivery. Request-method and history validation defects reproduce in one call and have direct regressions. The asynchronous model checks callback ownership, not AE/native execution after dispatch. |
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
