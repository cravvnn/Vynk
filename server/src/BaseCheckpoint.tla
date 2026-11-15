---- MODULE BaseCheckpoint ----
\* index.ts base PUT, getRoom and welcome. The panel supplies immutable bytes
\* captured at a known applied prefix. One edit can commit while those bytes
\* upload. Metadata persists the checkpoint with the hash; a legacy seq sidecar
\* may be stale at restart. Panel BaseCapture.tla supplies the snapshot interface.
\* Leaves out HTTP parsing/limits, file I/O errors, hash collisions and expiry.
EXTENDS Naturals
CONSTANTS CapturedCheckpoint, MetadataCheckpoint
VARIABLES seq, captured, phase, metadata, sidecar, base, restarted
vars == <<seq, captured, phase, metadata, sidecar, base, restarted>>
Init == /\ seq = 0 /\ captured = 0 /\ phase = "capture"
        /\ metadata = 0 /\ sidecar = 0 /\ base = 0 /\ restarted = FALSE
Capture == /\ phase = "capture" /\ captured' = seq /\ phase' = "upload"
           /\ UNCHANGED <<seq, metadata, sidecar, base, restarted>>
CommitEdit == /\ seq < 1 /\ seq' = seq + 1
              /\ UNCHANGED <<captured, phase, metadata, sidecar, base, restarted>>
CommitBase ==
  /\ phase = "upload"
  /\ metadata' = IF CapturedCheckpoint THEN captured ELSE seq
  /\ base' = IF CapturedCheckpoint THEN captured ELSE seq
  /\ phase' = "committed"
  /\ UNCHANGED <<seq, captured, sidecar, restarted>>
SaveSidecar == /\ phase = "committed" /\ sidecar # metadata /\ sidecar' = metadata
               /\ UNCHANGED <<seq, captured, phase, metadata, base, restarted>>
Restart ==
  /\ phase = "committed" /\ ~restarted
  /\ base' = IF MetadataCheckpoint THEN metadata ELSE sidecar
  /\ restarted' = TRUE
  /\ UNCHANGED <<seq, captured, phase, metadata, sidecar>>
Done == /\ phase = "committed" /\ seq = 1 /\ restarted /\ sidecar = metadata /\ UNCHANGED vars
Next == Capture \/ CommitEdit \/ CommitBase \/ SaveSidecar \/ Restart \/ Done
Spec == Init /\ [][Next]_vars
NoSkippedTail == phase = "committed" => base = captured
====
