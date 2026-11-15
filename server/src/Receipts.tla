---- MODULE Receipts ----
\* recovery.ts findReceipts/mergeReceipts, called by handleHello before joining.
\* Wanted is {1,3} or the known recent {2}. A two-entry initial log
\* has only its last entry in memory; two further commits may race a full scan.
\* A known committed record proves acceptance directly. An unreadable/missing
\* prefix refuses any remaining unknown IDs. A complete scan proves both
\* membership and absence through its snapshot. Merge needs a contiguous suffix;
\* after joining, handleOp retains receipts for advertised IDs on live commits.
\* Delivery.tla uses this accepted-ID interface; Append.tla supplies committed
\* ordered entries. Bounds: four entries, one-entry memory, one joining peer.
\* Excludes file decoding, I/O errors, hello validation, and log expiry.
EXTENDS Naturals, FiniteSets
CONSTANTS RequirePrefix, RequireSuffix, TrackLive, DirectEvidence, Wanted
VARIABLES committed, through, position, found, phase, broken
vars == <<committed, through, position, found, phase, broken>>
Init == /\ committed = 2 /\ through = 0 /\ position = 1 /\ found = {}
        /\ phase = "capture" /\ broken \in BOOLEAN
Commit ==
  /\ committed < 4
  /\ committed' = committed + 1
  /\ found' = IF TrackLive /\ phase = "ready" /\ committed + 1 \in Wanted
                 THEN found \cup {committed + 1} ELSE found
  /\ UNCHANGED <<through, position, phase, broken>>
Capture ==
  /\ phase = "capture"
  /\ through' = committed
  /\ found' = Wanted \cap {committed}
  /\ phase' = IF DirectEvidence /\ Wanted \subseteq {committed} THEN "merge" ELSE "scan"
  /\ UNCHANGED <<committed, position, broken>>
Read ==
  /\ phase = "scan" /\ position <= through
  /\ IF broken /\ position = 1 /\ RequirePrefix
       THEN /\ phase' = "refused" /\ UNCHANGED <<position, found>>
       ELSE /\ position' = position + 1 /\ UNCHANGED phase
            /\ found' = IF position \in Wanted /\ ~(broken /\ position = 1)
                           THEN found \cup {position} ELSE found
  /\ UNCHANGED <<committed, through, broken>>
FinishScan ==
  /\ phase = "scan" /\ position = through + 1
  /\ phase' = "merge" /\ UNCHANGED <<committed, through, position, found, broken>>
Merge ==
  /\ phase = "merge"
  /\ IF RequireSuffix /\ committed > through + 1
       THEN /\ phase' = "refused" /\ UNCHANGED found
       ELSE /\ phase' = "ready"
            /\ found' = IF committed > through /\ committed \in Wanted THEN found \cup {committed} ELSE found
  /\ UNCHANGED <<committed, through, position, broken>>
Done == /\ phase \in {"ready", "refused"} /\ committed = 4 /\ UNCHANGED vars
Next == Commit \/ Capture \/ Read \/ FinishScan \/ Merge \/ Done
Spec == Init /\ [][Next]_vars
NoAcceptedRetry == phase = "ready" => Wanted \cap (1..committed) \subseteq found
NoFalseReceipt == found \subseteq Wanted \cap (1..committed)
KnownReceiptSurvivesMissingPrefix ==
  (phase = "refused" /\ committed <= through + 1) => ~(Wanted \subseteq {through})
====
