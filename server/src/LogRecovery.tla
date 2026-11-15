---- MODULE LogRecovery ----
\* index.ts loadLog -> getRoom -> handleOp. An intact seq-1 prefix may end in
\* an incomplete/bad record, a complete record without its newline, or a read
\* error. Silently skipping it can concatenate the next successful append into
\* an unreadable line, or reuse a sequence hidden by the read failure.
\* File errors are abstract inputs; no automatic repair/truncation is modeled.
EXTENDS Naturals
CONSTANTS RejectCorrupt, RejectReadFailure
VARIABLES tail, phase, seq, newSeq, echoed, readableRecord
vars == <<tail, phase, seq, newSeq, echoed, readableRecord>>
Init == /\ tail \in {"clean", "partial", "no-newline", "bad-sequence", "unreadable"}
        /\ phase = "load" /\ seq = 0 /\ newSeq = 0
        /\ echoed = FALSE /\ readableRecord = FALSE
LoadLog ==
  /\ phase = "load"
  /\ phase' = IF (RejectReadFailure /\ tail = "unreadable") \/
                  (RejectCorrupt /\ tail \in {"partial", "no-newline", "bad-sequence"})
               THEN "refused" ELSE "joined"
  /\ seq' = IF tail = "unreadable" THEN 0 ELSE 1
  /\ UNCHANGED <<tail, newSeq, echoed, readableRecord>>
AppendAndEcho ==
  /\ phase = "joined" /\ phase' = "committed"
  /\ newSeq' = seq + 1 /\ echoed' = TRUE
  /\ readableRecord' = (tail \in {"clean", "unreadable"})
  /\ UNCHANGED <<tail, seq>>
Done == /\ phase \in {"refused", "committed"} /\ UNCHANGED vars
Next == LoadLog \/ AppendAndEcho \/ Done
Spec == Init /\ [][Next]_vars
EchoHasRecoverableRecord == ~echoed \/ readableRecord
NoSequenceReuseAfterReadFailure == ~echoed \/ newSeq > 1
====
