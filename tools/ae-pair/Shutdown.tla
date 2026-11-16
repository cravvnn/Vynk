---- MODULE Shutdown ----
\* run.mjs: quitInstances, called by --stop and main's finally block.
\* Two saved launch records, executable/PID ownership checks, project checks inside one
\* evalScript, graceful exit/timeout, then cleanup. AE can refuse to exit.
\* Read/check/close inside evalScript is serialized on AE's main thread.
\* HostProcesses models executable attribution. Startup, relay, PID reuse after
\* inspection and product sync are outside this model; see SPECS.md.
\* owned denotes the fresh executable/PID match, not merely a saved PID value.
EXTENDS FiniteSets

CONSTANTS Hosts, Legacy
VARIABLES alive, owned, disposable, checked, requested, forced, record, phase
vars == <<alive, owned, disposable, checked, requested, forced, record, phase>>

Init ==
  /\ alive = Hosts
  /\ owned \subseteq Hosts
  /\ disposable \subseteq Hosts
  /\ checked = {}
  /\ requested = {}
  /\ forced = {}
  /\ record = TRUE
  /\ phase = "request"

RequestQuit(h) ==
  /\ phase = "request"
  /\ h \notin checked
  /\ checked' = checked \cup {h}
  /\ requested' = IF Legacy \/ (h \in owned /\ h \in disposable)
                   THEN requested \cup {h} ELSE requested
  /\ UNCHANGED <<alive, owned, disposable, forced, record, phase>>

GracefulExit(h) ==
  /\ h \in alive /\ h \in requested
  /\ alive' = alive \ {h}
  /\ UNCHANGED <<owned, disposable, checked, requested, forced, record, phase>>

WaitForExit ==
  /\ phase = "request" /\ checked = Hosts
  /\ phase' = "wait"
  /\ UNCHANGED <<alive, owned, disposable, checked, requested, forced, record>>

FinishQuit ==
  /\ phase = "wait"
  /\ phase' = "done"
  /\ forced' = IF Legacy THEN alive ELSE forced
  /\ record' = IF Legacy THEN FALSE ELSE alive \cap owned # {}
  /\ UNCHANGED <<alive, owned, disposable, checked, requested>>

Done == /\ phase = "done" /\ UNCHANGED vars
Next == (\E h \in Hosts : RequestQuit(h) \/ GracefulExit(h)) \/ WaitForExit \/ FinishQuit \/ Done
Spec == Init /\ [][Next]_vars

NoForcedTermination == forced = {}
OnlyDisposableOwnedProjectsClose == requested \subseteq (owned \cap disposable)
LiveOwnedHostsRemainTracked == phase = "done" /\ alive \cap owned # {} => record
====
