---- MODULE ArbWrite ----
\* AeHost cmdArbSet / putArb, called by runCommands for main.js customDataSets
\* and createdCustomData. Both carry a whole static or animated parameter.
\* Parsing every key and checking every layout precede all key deletion.
\* AE calls run synchronously on the main thread; UI cannot interleave this
\* callback. A failed setter attempts restoration and never reports success.
\* One parameter, valid/invalid payload, matching/mismatched layouts, setter
\* success/failure and restoration success/failure. Real handles, key metadata,
\* bytes, time conversion and undo remain native codec / two-AE test gates.
\* Requests covers panel callback ownership; Delivery covers relay ordering.
EXTENDS Naturals
VARIABLES phase, valid, layout, setter, verified, restore, data, reported
vars == <<phase, valid, layout, setter, verified, restore, data, reported>>
Init == /\ phase = "call" /\ valid \in BOOLEAN /\ layout \in BOOLEAN
        /\ setter \in BOOLEAN /\ verified \in BOOLEAN /\ restore \in BOOLEAN
        /\ data = "old" /\ reported = "none"
CmdArbSet == /\ phase = "call"
             /\ IF valid /\ layout
                THEN /\ data' = IF setter THEN "new" ELSE "partial"
                     /\ phase' = IF setter /\ verified THEN "done" ELSE "rollback"
                     /\ reported' = IF setter /\ verified THEN "ok" ELSE "none"
                ELSE /\ data' = data /\ phase' = "done" /\ reported' = "error"
             /\ UNCHANGED <<valid, layout, setter, verified, restore>>
PutOriginal == /\ phase = "rollback" /\ phase' = "done"
               /\ data' = IF restore THEN "old" ELSE "partial"
               /\ reported' = "error"
               /\ UNCHANGED <<valid, layout, setter, verified, restore>>
Done == /\ phase = "done" /\ UNCHANGED vars
Next == CmdArbSet \/ PutOriginal \/ Done
Spec == Init /\ [][Next]_vars
RejectedUnchanged == (phase = "done" /\ (~valid \/ ~layout)) => data = "old"
NoFalseSuccess == reported = "ok" => (valid /\ layout /\ setter /\ verified /\ data = "new")
RestoredWhenPossible == (phase = "done" /\ valid /\ layout /\ ~(setter /\ verified) /\ restore) => data = "old"
====
