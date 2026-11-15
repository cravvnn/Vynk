---- MODULE Acknowledgements ----
\* main.js send -> trackPending and onRemoteOp -> acknowledge. Two consecutive
\* wire edits target the same field. A duplicate echo for the first may arrive
\* while the second is pending. The relay/transport interface supplies IDs;
\* Delivery.tla covers retry and commit, not this per-target accounting.
EXTENDS FiniteSets, Naturals
CONSTANTS Ops, First, MatchQueuedId
VARIABLES issued, queued, echoes, pending
vars == <<issued, queued, echoes, pending>>
Init == /\ issued = {} /\ queued = {} /\ echoes = [o \in Ops |-> 0] /\ pending = 0
Send(o) ==
  /\ o \notin issued /\ (o = First \/ First \in issued)
  /\ issued' = issued \cup {o} /\ queued' = queued \cup {o}
  /\ pending' = pending + 1
  /\ echoes' = [echoes EXCEPT ![o] = 2]
Echo(o) ==
  /\ echoes[o] > 0
  /\ echoes' = [echoes EXCEPT ![o] = @ - 1]
  /\ queued' = queued \ {o}
  /\ pending' = IF pending > 0 /\ (~MatchQueuedId \/ o \in queued) THEN pending - 1 ELSE pending
  /\ UNCHANGED issued
Done == /\ issued = Ops /\ \A o \in Ops : echoes[o] = 0 /\ UNCHANGED vars
Next == (\E o \in Ops : Send(o) \/ Echo(o)) \/ Done
Spec == Init /\ [][Next]_vars
PendingMatchesQueue == pending = Cardinality(queued)
====
