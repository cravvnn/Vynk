---- MODULE Delivery ----
\* main.js send/flushOutbox/onRemoteOp, and the relay's ordered handleOp log.
\* Two previously joined editors each make one edit. Reconnect attempts may
\* lose either a frame or its echo,
\* then reconnect once. Welcome confirms the advertised queue against the log;
\* a late old frame can race a retried frame. The server records an ID once.
\* Stored is the panel's write-through localStorage interface; log is the
\* successful append interface. Host edits are already present before Send.
\* Excludes value-level LWW, AE reads/applies, room/project scope, storage failure,
\* log truncation, server crashes and the disk-scan implementation. See SPECS.md.
EXTENDS FiniteSets, Naturals
CONSTANTS Editors, RetainUntilEcho, WelcomeGate, Deduplicate
VARIABLES issued, stored, queued, phase, attempt, advertised, sent, network,
          log, commits, echoes, premature
vars == <<issued, stored, queued, phase, attempt, advertised, sent, network,
          log, commits, echoes, premature>>

Init ==
  /\ issued = {} /\ stored = {} /\ queued = {}
  /\ phase = [p \in Editors |-> "closed"]
  /\ attempt = [p \in Editors |-> 0]
  /\ advertised = [p \in Editors |-> {}]
  /\ sent = {} /\ network = {} /\ log = {}
  /\ commits = [p \in Editors |-> 0]
  /\ echoes = {} /\ premature = FALSE

LocalEdit(p) ==
  /\ p \notin issued
  /\ issued' = issued \cup {p}
  /\ queued' = queued \cup {p} /\ stored' = stored \cup {p}
  /\ UNCHANGED <<phase, attempt, advertised, sent, network, log, commits,
                 echoes, premature>>

Connect(p) ==
  /\ phase[p] = "closed" /\ attempt[p] < 2
  /\ phase' = [phase EXCEPT ![p] = "open"]
  /\ attempt' = [attempt EXCEPT ![p] = @ + 1]
  /\ advertised' = [advertised EXCEPT ![p] = queued \cap {p}]
  /\ UNCHANGED <<issued, stored, queued, sent, network, log, commits,
                 echoes, premature>>

Welcome(p) ==
  /\ phase[p] = "open"
  /\ phase' = [phase EXCEPT ![p] = "joined"]
  /\ queued' = queued \ (advertised[p] \cap log)
  /\ stored' = stored \ (advertised[p] \cap log)
  /\ UNCHANGED <<issued, attempt, advertised, sent, network, log, commits,
                 echoes, premature>>

Send(p) ==
  /\ p \in queued /\ <<p, attempt[p]>> \notin sent
  /\ IF WelcomeGate THEN phase[p] = "joined" ELSE phase[p] # "closed"
  /\ sent' = sent \cup {<<p, attempt[p]>>}
  /\ network' = network \cup {<<p, attempt[p]>>}
  /\ queued' = IF RetainUntilEcho THEN queued ELSE queued \ {p}
  /\ stored' = IF RetainUntilEcho THEN stored ELSE stored \ {p}
  /\ premature' = (premature \/ phase[p] # "joined")
  /\ UNCHANGED <<issued, phase, attempt, advertised, log, commits,
                 echoes>>

HandleOp(p, a) ==
  /\ <<p, a>> \in network
  /\ network' = network \ {<<p, a>>}
  /\ commits' = IF Deduplicate /\ p \in log THEN commits
                  ELSE [commits EXCEPT ![p] = @ + 1]
  /\ log' = log \cup {p} /\ echoes' = echoes \cup {p}
  /\ UNCHANGED <<issued, stored, queued, phase, attempt, advertised, sent,
                 premature>>

DropFrame(p, a) ==
  /\ <<p, a>> \in network
  /\ network' = network \ {<<p, a>>}
  /\ UNCHANGED <<issued, stored, queued, phase, attempt, advertised, sent,
                 log, commits, echoes, premature>>

OnRemoteOp(p) ==
  /\ p \in echoes
  /\ echoes' = echoes \ {p}
  /\ queued' = queued \ {p} /\ stored' = stored \ {p}
  /\ UNCHANGED <<issued, phase, attempt, advertised, sent, network, log,
                 commits, premature>>

Disconnect(p) ==
  /\ phase[p] # "closed"
  /\ phase' = [phase EXCEPT ![p] = "closed"]
  /\ queued' = (queued \ {p}) \cup (stored \cap {p})
  /\ UNCHANGED <<issued, stored, attempt, advertised, sent, network, log,
                 commits, echoes, premature>>

Done == /\ \A p \in Editors : attempt[p] = 2 /\ phase[p] = "closed"
        /\ network = {} /\ echoes = {} /\ UNCHANGED vars
Next == (\E p \in Editors : LocalEdit(p) \/ Connect(p) \/ Welcome(p) \/ Send(p)
                           \/ OnRemoteOp(p) \/ Disconnect(p))
     \/ (\E p \in Editors, a \in 1..2 : HandleOp(p, a) \/ DropFrame(p, a)) \/ Done
Spec == Init /\ [][Next]_vars
NoLostEdit == issued \subseteq stored \cup log
NoDuplicateCommit == \A p \in Editors : commits[p] <= 1
NoOpBeforeWelcome == ~premature
====
