---- MODULE RoomToken ----
\* index.ts getRoom/saveToken/sweepOldLogs. One room join races an expiry sweep;
\* an old token may have fresh retained state. A new token write may fail.
\* The sweep reservation excludes getRoom, and a pending join excludes sweeping.
\* Token rename is an atomic success/failure interface, not a power-loss proof.
\* Excludes multiple server processes sharing storage and filesystem corruption.
EXTENDS Naturals
CONSTANTS AwaitWrite, KeepFresh, SweepBarrier
VARIABLES stored, fresh, oldAtStart, phase, joining, active, purging, sweepDone,
          loaded, published, badPublish
vars == <<stored, fresh, oldAtStart, phase, joining, active, purging, sweepDone,
          loaded, published, badPublish>>
Init == /\ stored \in {"none", "old"} /\ fresh \in BOOLEAN
        /\ oldAtStart = (stored = "old") /\ phase = "idle"
        /\ joining = FALSE /\ active = FALSE /\ purging = FALSE
        /\ sweepDone = FALSE /\ loaded = "none" /\ published = "none"
        /\ badPublish = FALSE
GetRoom ==
  /\ phase = "idle" /\ (~SweepBarrier \/ ~purging)
  /\ joining' = TRUE /\ phase' = "load"
  /\ UNCHANGED <<stored, fresh, oldAtStart, active, purging, sweepDone,
                  loaded, published, badPublish>>
LoadToken ==
  /\ phase = "load"
  /\ loaded' = IF stored = "none" THEN "new" ELSE stored
  /\ phase' = IF stored = "none" THEN "write" ELSE "ready"
  /\ UNCHANGED <<stored, fresh, oldAtStart, joining, active, purging,
                  sweepDone, published, badPublish>>
WriteSuccess ==
  /\ phase = "write" /\ stored' = loaded /\ phase' = "ready"
  /\ UNCHANGED <<fresh, oldAtStart, joining, active, purging, sweepDone,
                  loaded, published, badPublish>>
WriteFailure ==
  /\ phase = "write" /\ phase' = "refused" /\ joining' = FALSE
  /\ UNCHANGED <<stored, fresh, oldAtStart, active, purging, sweepDone,
                  loaded, published, badPublish>>
Publish ==
  /\ phase = "ready" \/ (~AwaitWrite /\ phase = "write")
  /\ published' = loaded /\ active' = TRUE /\ joining' = FALSE /\ phase' = "active"
  /\ badPublish' = (badPublish \/ stored # loaded)
  /\ UNCHANGED <<stored, fresh, oldAtStart, purging, sweepDone, loaded>>
StartSweep ==
  /\ ~active /\ ~joining /\ ~purging /\ ~sweepDone
  /\ purging' = TRUE
  /\ UNCHANGED <<stored, fresh, oldAtStart, phase, joining, active, sweepDone,
                  loaded, published, badPublish>>
FinishSweep ==
  /\ purging
  /\ stored' = IF KeepFresh /\ fresh THEN stored ELSE "none"
  /\ purging' = FALSE /\ sweepDone' = TRUE
  /\ UNCHANGED <<fresh, oldAtStart, phase, joining, active, loaded, published, badPublish>>
Done == /\ phase \in {"active", "refused"} /\ ~purging /\ UNCHANGED vars
Next == GetRoom \/ LoadToken \/ WriteSuccess \/ WriteFailure \/ Publish \/ StartSweep \/ FinishSweep \/ Done
Spec == Init /\ [][Next]_vars
NoUnstoredPublish == ~badPublish
NoActiveTokenLoss == ~active \/ stored = published
RetainedGeneration == ~(oldAtStart /\ fresh) \/ stored = "old"
====
