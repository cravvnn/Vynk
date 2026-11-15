---- MODULE Replay ----
\* main.js resumeDelivery -> tryApplyReplay -> acceptRemote -> host inbox.
\* Host already contains an accepted own scalar edit and group removal; its
\* echo was lost. A complete ordered log contains an older missed scalar,
\* that own batch, a disjoint field, and optionally a later scalar. The base
\* may already contain the own batch. One live scalar may arrive during fetch
\* or planning. A separate unaccepted local scalar may protect the same key.
\* HTTP yields a complete prefix or no replay; Requests/Transfers cover stale
\* or incomplete responses. Host applies inbox groups atomically in FIFO order.
\* Excludes AE setter side effects, structural conflict resolution, host apply
\* failure, seen-ID eviction, crashes, and later live traffic after planning.
EXTENDS Naturals, Sequences
CONSTANTS ProtectSeen, HoldLive, SkipOwn, WaitReplay
VARIABLES phase, cursor, known, live, deferred, inbox, x, y, removed,
          hasLater, pending, anchor
vars == <<phase, cursor, known, live, deferred, inbox, x, y, removed,
          hasLater, pending, anchor>>
Through == IF hasLater THEN 4 ELSE 3
Entry(k, v) == [key |-> k, value |-> v]

Init ==
  /\ hasLater \in BOOLEAN /\ pending \in BOOLEAN /\ anchor \in {0, 2}
  /\ phase = "welcome" /\ cursor = anchor + 1 /\ known = FALSE
  /\ live = FALSE /\ deferred = FALSE /\ inbox = <<>>
  /\ x = IF pending THEN 123 ELSE 88
  /\ y = 0 /\ removed = 1

Welcome ==
  /\ phase = "welcome"
  /\ known' = TRUE /\ phase' = "fetch"
  /\ UNCHANGED <<cursor, live, deferred, inbox, x, y, removed,
                  hasLater, pending, anchor>>
HistoryComplete ==
  /\ phase = "fetch" /\ phase' = "replay"
  /\ UNCHANGED <<cursor, known, live, deferred, inbox, x, y, removed,
                  hasLater, pending, anchor>>
Live ==
  /\ phase \in {"fetch", "replay"} /\ ~live
  /\ live' = TRUE /\ deferred' = HoldLive
  /\ inbox' = IF HoldLive \/ pending THEN inbox ELSE Append(inbox, Entry("x", 111))
  /\ UNCHANGED <<phase, cursor, known, x, y, removed, hasLater, pending, anchor>>
ReplayOne ==
  /\ phase = "replay" /\ cursor <= Through
  /\ cursor' = cursor + 1
  /\ inbox' = IF cursor = 2
       THEN IF SkipOwn /\ known THEN inbox ELSE Append(inbox, Entry("own", 88))
       ELSE IF cursor = 3 THEN Append(inbox, Entry("y", 7))
       ELSE IF pending \/ (ProtectSeen /\ known /\ cursor < 2) THEN inbox
       ELSE Append(inbox, Entry("x", IF cursor = 1 THEN 11 ELSE 99))
  /\ UNCHANGED <<phase, known, live, deferred, x, y, removed,
                  hasLater, pending, anchor>>
ReplayDone ==
  /\ phase = "replay" /\ cursor > Through
  /\ phase' = "drain" /\ deferred' = FALSE
  /\ inbox' = IF deferred /\ ~pending THEN Append(inbox, Entry("x", 111)) ELSE inbox
  /\ UNCHANGED <<cursor, known, live, x, y, removed, hasLater, pending, anchor>>
Apply ==
  /\ Len(inbox) > 0
  /\ x' = IF Head(inbox).key \in {"x", "own"} THEN Head(inbox).value ELSE x
  /\ y' = IF Head(inbox).key = "y" THEN Head(inbox).value ELSE y
  /\ removed' = IF Head(inbox).key = "own" THEN removed + 1 ELSE removed
  /\ inbox' = Tail(inbox)
  /\ UNCHANGED <<phase, cursor, known, live, deferred, hasLater, pending, anchor>>
Done == /\ phase = "drain" /\ inbox = <<>> /\ phase' = "done"
        /\ UNCHANGED <<cursor, known, live, deferred, inbox, x, y, removed,
                        hasLater, pending, anchor>>
Idle == /\ phase = "done" /\ UNCHANGED vars
Next == Welcome \/ HistoryComplete \/ Live \/ ReplayOne \/ ReplayDone \/ Apply \/ Done \/ Idle
Spec == Init /\ [][Next]_vars
RelayOrderWins == phase # "done" \/
  x = (IF pending THEN 123 ELSE IF live THEN 111 ELSE IF hasLater THEN 99 ELSE 88)
DisjointEditPreserved == phase # "done" \/ y = 7
OwnRemovalNotRepeated == removed = 1
CaughtUp == phase # "welcome" /\ inbox = <<>> /\
  (~WaitReplay \/ phase \in {"drain", "done"})
NoPrematureRepair == ~CaughtUp \/ phase \in {"drain", "done"}
====
