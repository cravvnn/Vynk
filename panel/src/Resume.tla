---- MODULE Resume ----
\* main.js hello/welcome/currentResume/tryApplyReplay and index.ts hello.after.
\* B's existing project is on an observed shared prefix 0. A deletes Left at
\* seq 1 while B is offline; B has a disjoint local Right=9. A base capturing
\* seq 1 may be published before welcome or while catch-up waits. Reconnect
\* requests the original prefix, bound to room token and in-memory project.
\* A project/token change holds that replay. Explicit base open discards this
\* context (BaseOpen.tla). Reload deliberately has no resume capability.
\* Leaves out HTTP paging, native apply failures, structural conflicts, seen-ID
\* eviction and arbitrary crashes. Replay.tla covers live/receipt value order.
EXTENDS Naturals
CONSTANTS RequestAnchor, CheckScope, KeepAnchor, IgnoreOldSocket, PreserveProjectHold
VARIABLES phase, base, anchor, context, token, continuing, held, left, right,
          wrongScope, reconnected, requested, replayContext
vars == <<phase, base, anchor, context, token, continuing, held, left, right,
          wrongScope, reconnected, requested, replayContext>>
Init == /\ phase = "offline" /\ base = 0 /\ anchor = 0
        /\ context = 0 /\ token = 0 /\ continuing = FALSE /\ held = FALSE
        /\ left = TRUE /\ right = 9 /\ wrongScope = FALSE /\ reconnected = FALSE
        /\ requested = TRUE /\ replayContext = 0
Hello == /\ phase = "offline" /\ phase' = "hello"
         /\ UNCHANGED <<base, anchor, context, token, continuing, held, left, right, wrongScope, reconnected, requested, replayContext>>
Welcome ==
  /\ phase = "hello"
  /\ phase' = "waiting"
  /\ held' = (held \/ (CheckScope /\ requested /\ (context # 0 \/ token # 0)))
  /\ continuing' = (RequestAnchor /\ requested /\ context = 0 /\ token = 0)
  /\ anchor' = IF RequestAnchor /\ requested THEN 0 ELSE base
  /\ replayContext' = context
  /\ UNCHANGED <<base, context, token, left, right, wrongScope, reconnected, requested>>
NewBase ==
  /\ base = 0 /\ phase \in {"offline", "hello", "waiting"}
  /\ base' = 1
  /\ held' = (held \/ (phase = "waiting" /\ continuing /\ ~KeepAnchor))
  /\ UNCHANGED <<phase, anchor, context, token, continuing, left, right, wrongScope, reconnected, requested, replayContext>>
ProjectChange ==
  /\ context = 0 /\ phase \in {"hello", "waiting"}
  /\ context' = 1 /\ continuing' = FALSE
  /\ held' = (held \/ (PreserveProjectHold /\ phase = "waiting"))
  /\ UNCHANGED <<phase, base, anchor, token, left, right, wrongScope, reconnected, requested, replayContext>>
TokenChange ==
  /\ token = 0 /\ phase = "hello" /\ token' = 1
  /\ UNCHANGED <<phase, base, anchor, context, continuing, held, left, right, wrongScope, reconnected, requested, replayContext>>
ReconnectBeforeWelcome ==
  /\ phase = "waiting" /\ ~reconnected
  /\ phase' = "hello" /\ reconnected' = TRUE /\ continuing' = FALSE
  /\ held' = (held \/ ~IgnoreOldSocket)
  /\ requested' = (context = 0)
  /\ UNCHANGED <<base, anchor, context, token, left, right, wrongScope, replayContext>>
Replay ==
  /\ phase = "waiting"
  /\ IF held \/ (CheckScope /\ (context # replayContext \/ token # 0))
       THEN /\ phase' = "held" /\ UNCHANGED <<left, wrongScope>>
       ELSE /\ phase' = "done"
            /\ left' = IF anchor < 1 THEN FALSE ELSE left
            /\ wrongScope' = (wrongScope \/ (anchor < 1 /\ (context # 0 \/ token # 0)))
  /\ UNCHANGED <<base, anchor, context, token, continuing, held, right, reconnected, requested, replayContext>>
Done == /\ phase \in {"done", "held"} /\ UNCHANGED vars
Next == Hello \/ Welcome \/ NewBase \/ ProjectChange \/ TokenChange \/ ReconnectBeforeWelcome \/ Replay \/ Done
Spec == Init /\ [][Next]_vars
MissedDeletePreserved == (phase = "done" /\ context = 0 /\ token = 0) => ~left
OfflineIntentPreserved == right = 9
NoWrongScopeApply == ~wrongScope
KnownResumeKept == (phase = "waiting" /\ continuing /\ context = 0 /\ token = 0) => (~held /\ anchor = 0)
NoTransportHold == (reconnected /\ context = 0 /\ token = 0) => ~held
====
