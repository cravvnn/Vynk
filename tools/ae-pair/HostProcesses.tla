---- MODULE HostProcesses ----
\* host-process.mjs selectHostProcess, used for run.mjs startup, attach,
\* focus, dialog handling and graceful shutdown. Both stable versions are
\* named AfterFX.exe, so a basename cannot identify the requested host.
\* One fresh process inventory, two executable paths, a duplicate instance
\* and a process whose path cannot be read. PID reuse after inspection,
\* Windows APIs and the serialized JSX channel are outside this model.
EXTENDS Naturals, FiniteSets
Processes == {"a", "b", "aCopy", "unknown"}
Path(p) == CASE p \in {"a", "aCopy"} -> "A"
              [] p = "b" -> "B"
              [] OTHER -> "unreadable"
VARIABLES live, want, phase, chosen
vars == <<live, want, phase, chosen>>
Init == /\ live \subseteq Processes /\ want \in {"A", "B"}
        /\ phase = "query" /\ chosen = "none"
Matches == {p \in live : Path(p) = want}
Resolve == /\ phase = "query" /\ phase' = "done"
           /\ chosen' = IF ("unknown" \in live) \/ Cardinality(Matches) > 1
                        THEN "error"
                        ELSE IF Matches = {} THEN "none" ELSE CHOOSE p \in Matches : TRUE
           /\ UNCHANGED <<live, want>>
Done == /\ phase = "done" /\ UNCHANGED vars
Next == Resolve \/ Done
Spec == Init /\ [][Next]_vars
ResolvedHost == chosen \in Processes => Path(chosen) = want
UniqueBinding == chosen \in Processes => Cardinality(Matches) = 1
UnreadableRefused == (phase = "done" /\ "unknown" \in live) => chosen = "error"
====
