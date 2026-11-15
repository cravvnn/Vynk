---- MODULE BaseOpen ----
\* main.js getBase/checkBaseOpen/openBaseScript/baseOpened/connect/welcome.
\* Starts after an edit was seen on the old project and a matching base downloaded.
\* One host query, a confirmed posted open, a socket loss or an attempted room
\* change, a new UI edit/project, and a changed room base may interleave.
\* The host checks file/revision atomically with open; Requests covers callbacks
\* before dispatch. This model does not assert cancellation after app.open starts,
\* or model manual panel reload during a native call, AE modal dialogs or I/O.
\* NativeOpen calls sync.jsx openBase atomically; BaseView.tla covers its local
\* playhead capture/restore contract. No playhead position enters relay ops.
EXTENDS Naturals
CONSTANTS RevisionGuard, FileGuard, ResetSeen, BindBase, CriticalBarrier, KeepPostedJob
VARIABLES phase, context, revision, file, guardRevision, guardFile, seen,
          replayed, opened, wrongOpen, base, changed, dropped, jobAlive, confirmed
vars == <<phase, context, revision, file, guardRevision, guardFile, seen,
          replayed, opened, wrongOpen, base, changed, dropped, jobAlive, confirmed>>
Init == /\ phase = "download" /\ context = 0 /\ revision = 0 /\ file = 0
        /\ guardRevision = 0 /\ guardFile = 0 /\ seen = TRUE /\ replayed = FALSE
        /\ opened = FALSE /\ wrongOpen = FALSE /\ base = 0 /\ changed = FALSE
        /\ dropped = FALSE /\ jobAlive = TRUE /\ confirmed \in BOOLEAN
Download == /\ phase = "download" /\ phase' = IF context = 0 THEN "check" ELSE "cancelled"
            /\ UNCHANGED <<context, revision, file, guardRevision, guardFile, seen,
                           replayed, opened, wrongOpen, base, changed, dropped, jobAlive>>
QueryAndConfirm ==
  /\ phase = "check"
  /\ phase' = IF context = 0 /\ confirmed THEN "open" ELSE "cancelled"
  /\ guardRevision' = revision /\ guardFile' = file
  /\ UNCHANGED <<context, revision, file, seen, replayed, opened, wrongOpen, base, changed, dropped, jobAlive>>
LocalEdit == /\ phase = "open" /\ revision = 0 /\ revision' = 1
             /\ UNCHANGED <<phase, context, file, guardRevision, guardFile, seen,
                            replayed, opened, wrongOpen, base, changed, dropped, jobAlive>>
SwitchProject == /\ phase = "open" /\ file = 0 /\ file' = 1
                 /\ UNCHANGED <<phase, context, revision, guardRevision, guardFile, seen,
                                replayed, opened, wrongOpen, base, changed, dropped, jobAlive>>
SwitchRoom ==
  /\ context = 0 /\ phase \in {"download", "check", "open"}
  /\ (~CriticalBarrier \/ phase # "open") /\ context' = 1
  /\ UNCHANGED <<phase, revision, file, guardRevision, guardFile, seen, replayed,
                 opened, wrongOpen, base, changed, dropped, jobAlive>>
Disconnect ==
  /\ phase = "open" /\ ~dropped /\ dropped' = TRUE
  /\ jobAlive' = KeepPostedJob
  /\ UNCHANGED <<phase, context, revision, file, guardRevision, guardFile, seen,
                 replayed, opened, wrongOpen, base, changed>>
NativeOpen ==
  /\ phase = "open"
  /\ IF (RevisionGuard /\ revision # guardRevision) \/ (FileGuard /\ file # guardFile)
       THEN /\ phase' = "cancelled" /\ UNCHANGED <<opened, wrongOpen, seen>>
       ELSE /\ opened' = TRUE /\ phase' = IF jobAlive THEN "fresh" ELSE "orphaned"
            /\ wrongOpen' = (context # 0 \/ revision # guardRevision \/ file # guardFile)
            /\ seen' = IF ResetSeen THEN FALSE ELSE seen
  /\ UNCHANGED <<context, revision, file, guardRevision, guardFile, replayed,
                 base, changed, dropped, jobAlive>>
ChangeBase ==
  /\ ~changed /\ phase \in {"download", "check", "open", "fresh"}
  /\ base' = 1 /\ changed' = TRUE
  /\ UNCHANGED <<phase, context, revision, file, guardRevision, guardFile, seen,
                 replayed, opened, wrongOpen, dropped, jobAlive>>
FreshWelcome ==
  /\ phase = "fresh"
  /\ IF BindBase /\ base # 0
       THEN /\ phase' = "held" /\ UNCHANGED <<seen, replayed>>
       ELSE /\ phase' = "ready" /\ replayed' = ~seen /\ seen' = TRUE
  /\ UNCHANGED <<context, revision, file, guardRevision, guardFile, opened,
                 wrongOpen, base, changed, dropped, jobAlive>>
Done == /\ phase \in {"ready", "held", "cancelled", "orphaned"} /\ UNCHANGED vars
Next == (Download \/ QueryAndConfirm \/ LocalEdit \/ SwitchProject \/ SwitchRoom
     \/ Disconnect \/ NativeOpen \/ ChangeBase \/ FreshWelcome \/ Done) /\ UNCHANGED confirmed
Spec == Init /\ [][Next]_vars
NoWrongProjectOpen == ~wrongOpen
NoStrandedOpen == opened => phase \in {"fresh", "ready", "held"}
FreshHistoryReapplied == phase = "ready" => replayed
NoWrongBaseReplay == phase = "ready" => base = 0
NoUnconfirmedOpen == opened => confirmed
====
