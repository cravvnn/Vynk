---- MODULE BaseUpload ----
\* index.ts base PUT reservation, per-room baseUploading, closePeer/releaseRoom
\* and getRoom. Two uploads may attempt to start after the ordinary rate window;
\* one last-peer close and one rejoin may race completion. getRoom's lookup/create
\* and successful file commit are abstract interfaces. Append/Receipts model
\* ordered edits and joining; BaseCheckpoint models captured sequence metadata.
\* Leaves out limits, I/O failures, cleanup, process crash and expiry.
EXTENDS FiniteSets, Naturals
CONSTANTS Jobs, ReserveUpload, ExclusiveUpload
VARIABLES active, started, committed, owner, generation, exists, peer, left,
          joined, diskBase, cache
vars == <<active, started, committed, owner, generation, exists, peer, left,
          joined, diskBase, cache>>
Init == /\ active = {} /\ started = {} /\ committed = {} /\ owner = [j \in Jobs |-> 0]
        /\ generation = 0 /\ exists = TRUE /\ peer = TRUE /\ left = FALSE
        /\ joined = FALSE /\ diskBase = FALSE /\ cache = FALSE
BeginUpload(j) ==
  /\ peer /\ j \notin started /\ (~ExclusiveUpload \/ active = {})
  /\ active' = active \cup {j} /\ started' = started \cup {j}
  /\ owner' = [owner EXCEPT ![j] = generation]
  /\ UNCHANGED <<committed, generation, exists, peer, left, joined, diskBase, cache>>
CommitUpload(j) ==
  /\ j \in active /\ active' = active \ {j} /\ committed' = committed \cup {j}
  /\ diskBase' = TRUE
  /\ cache' = IF owner[j] = generation THEN TRUE ELSE cache
  /\ UNCHANGED <<started, owner, generation, exists, peer, left, joined>>
LeavePeer == /\ peer /\ ~left /\ peer' = FALSE /\ left' = TRUE
             /\ UNCHANGED <<active, started, committed, owner, generation, exists, joined, diskBase, cache>>
ReleaseRoom ==
  /\ ~peer /\ exists /\ generation < 1
  /\ (~ReserveUpload \/ active = {})
  /\ exists' = FALSE /\ generation' = generation + 1 /\ cache' = FALSE
  /\ UNCHANGED <<active, started, committed, owner, peer, left, joined, diskBase>>
GetRoom ==
  /\ left /\ ~joined /\ joined' = TRUE /\ peer' = TRUE /\ exists' = TRUE
  /\ cache' = IF exists THEN cache ELSE diskBase
  /\ UNCHANGED <<active, started, committed, owner, generation, left, diskBase>>
Done == /\ committed = Jobs /\ UNCHANGED vars
Next == (\E j \in Jobs : BeginUpload(j) \/ CommitUpload(j)) \/ LeavePeer \/ ReleaseRoom \/ GetRoom \/ Done
Spec == Init /\ [][Next]_vars
OneBaseWriter == Cardinality(active) <= 1
CompletedUploadVisible == joined /\ committed # {} => cache
====
