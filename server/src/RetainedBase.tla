---- MODULE RetainedBase ----
\* index.ts startup sweep -> getRoom -> handleOp -> late welcome. A fresh base
\* at seq 2 survives while the old log expires, or the log retains seq 2/3.
\* The recovered room must allocate new entries above the known base prefix.
\* This does not recover edits lost after that base or prove filesystem expiry.
EXTENDS Naturals
CONSTANT BaseFloor
VARIABLES phase, tail, seq, written, expired
vars == <<phase, tail, seq, written, expired>>
Init == /\ phase = "offline" /\ tail \in {2, 3}
        /\ seq = 0 /\ written = 0 /\ expired = FALSE
Expire == /\ phase = "offline" /\ ~expired
          /\ tail' = 0 /\ expired' = TRUE
          /\ UNCHANGED <<phase, seq, written>>
GetRoom == /\ phase = "offline" /\ phase' = "joined"
           /\ seq' = IF BaseFloor /\ tail < 2 THEN 2 ELSE tail
           /\ UNCHANGED <<tail, written, expired>>
HandleOp == /\ phase = "joined" /\ phase' = "written"
            /\ seq' = seq + 1 /\ written' = seq + 1
            /\ UNCHANGED <<tail, expired>>
Done == /\ phase = "written" /\ UNCHANGED vars
Next == Expire \/ GetRoom \/ HandleOp \/ Done
Spec == Init /\ [][Next]_vars
SequenceAtLeastBase == phase = "offline" \/ seq >= 2
NewEditVisibleAfterBase == written = 0 \/ written > 2
====
