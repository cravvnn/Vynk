---- MODULE Observation ----
\* main.js pickReads / handleCycle: a remote iadd is an upsert, including
\* answerNeed(items)'s repeated announcements. An existing comp keeps its
\* observed baseline. A newly created remote comp is read in the same atomic
\* JSX apply/read call, before a subsequent local edit can run. Observe then
\* diffs that baseline before adopting the current host state.
\* answerNeed(full) sees one peer-only layer; it must request it, never remove
\* it, including before that comp ever matched. Need describes the peer's
\* observed state; no assumption is made that first mismatch means deletion.
\* One scalar and one layer, one upsert and one edit, successful host reads.
\* Delivery/Replay cover queue/relay order; AE failures, reload bootstrap and
\* arbitrary structural conflicts are outside this model.
EXTENDS Naturals
CONSTANTS PreserveComp, ReadCreated, KeepPeer
VARIABLES mode, phase, hostValue, hostLayer, shadowValue, shadowLayer,
          baseline, emitted, removed
vars == <<mode, phase, hostValue, hostLayer, shadowValue, shadowLayer,
          baseline, emitted, removed>>
Init == /\ mode \in {"existing", "created", "peer"}
        /\ phase = IF mode = "created" THEN "create" ELSE IF mode = "peer" THEN "repair" ELSE "edit"
        /\ hostValue = 0 /\ hostLayer = (mode = "peer")
        /\ shadowValue = 0 /\ shadowLayer = FALSE
        /\ baseline = (mode # "created")
        /\ emitted = FALSE /\ removed = FALSE
CreateComp == /\ phase = "create" /\ phase' = "edit"
              /\ baseline' = ReadCreated
              /\ UNCHANGED <<mode, hostValue, hostLayer, shadowValue, shadowLayer, emitted, removed>>
LocalEdit == /\ phase = "edit" /\ hostValue' = 1 /\ hostLayer' = TRUE
             /\ phase' = IF mode = "existing" THEN "upsert" ELSE "observe"
             /\ UNCHANGED <<mode, shadowValue, shadowLayer, baseline, emitted, removed>>
HandleCompUpsert == /\ phase = "upsert" /\ phase' = "observe"
                    /\ baseline' = IF PreserveComp THEN baseline ELSE FALSE
                    /\ UNCHANGED <<mode, hostValue, hostLayer, shadowValue, shadowLayer, emitted, removed>>
Observe == /\ phase = "observe" /\ phase' = "done"
           /\ emitted' = baseline /\ (hostValue # shadowValue \/ hostLayer # shadowLayer)
           /\ shadowValue' = hostValue /\ shadowLayer' = hostLayer /\ baseline' = TRUE
           /\ UNCHANGED <<mode, hostValue, hostLayer, removed>>
AnswerNeed == /\ phase = "repair" /\ phase' = "done"
              /\ removed' = ~KeepPeer /\ hostLayer' = KeepPeer
              /\ UNCHANGED <<mode, hostValue, shadowValue, shadowLayer, baseline, emitted>>
Done == /\ phase = "done" /\ UNCHANGED vars
Next == CreateComp \/ LocalEdit \/ HandleCompUpsert \/ Observe \/ AnswerNeed \/ Done
Spec == Init /\ [][Next]_vars
LocalEditAnnounced == (phase = "done" /\ mode # "peer") => emitted
RepairPreservesPeerLayer == ~removed
====
