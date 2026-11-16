---- MODULE CustomData ----
\* main.js runCycle -> host cycle -> customDataPass/customDataSets -> ARBGET.
\* One received batch reconstructs an effect and supplies its arbitrary data.
\* Native writes use the fresh host snapshot's effect/parameter positions.
\* A pre-host native phase can write an effect that the host then reconstructs.
\* Phase ordering uses no extra pending queue or flags. Native SDK errors and
\* byte/layout validation are modeled by aegp/src/ArbWrite.tla; transport and
\* callback generation are Delivery and Requests. One effect reconstruction,
\* one whole key sequence, one native read. Layer-time coordinates remove the
\* need to map comp offsets in the payload. Stretch/reverse are real-AE gates.
EXTENDS Integers
VARIABLES phase, rebuilt, data, readData
vars == <<phase, rebuilt, data, readData>>
Init == /\ phase = "host" /\ rebuilt = FALSE /\ data = "old" /\ readData = "none"
HostCycle == /\ phase = "host" /\ rebuilt' = TRUE /\ data' = "default"
             /\ phase' = IF data = "new" THEN "read" ELSE "native"
             /\ UNCHANGED readData
CustomDataSets == /\ phase = "native" /\ data' = "new"
                  /\ phase' = IF rebuilt THEN "read" ELSE "host"
                  /\ UNCHANGED <<rebuilt, readData>>
CustomDataRead == /\ phase = "read" /\ phase' = "done"
                  /\ readData' = data
                  /\ UNCHANGED <<rebuilt, data>>
Done == /\ phase = "done" /\ UNCHANGED vars
Next == HostCycle \/ CustomDataSets \/ CustomDataRead \/ Done
Spec == Init /\ [][Next]_vars
CreatedValuePreserved == phase = "done" => (rebuilt /\ readData = "new")
====
