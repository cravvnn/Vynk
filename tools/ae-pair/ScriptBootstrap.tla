---- MODULE ScriptBootstrap ----
\* run-script.mjs: a file command may survive its sender's timeout. A late
\* panel consumes that queued command after the command-line fallback opens it.
\* Probe results and delivery timing are nondeterministic; OS routing is external.
EXTENDS Naturals
VARIABLES phase, queuedMutation, executions
vars == <<phase, queuedMutation, executions>>
Init == /\ phase = "probe" /\ queuedMutation = FALSE /\ executions = 0
Ready == /\ phase = "probe" /\ phase' = "execute"
         /\ UNCHANGED <<queuedMutation, executions>>
NoPanel == /\ phase = "probe" /\ phase' = "fallback"
           /\ queuedMutation' = FALSE /\ UNCHANGED executions
Execute == /\ phase = "execute" /\ executions' = executions + 1
           /\ phase' \in {"done", "uncertain"} /\ UNCHANGED queuedMutation
StopUncertain == /\ phase = "uncertain" /\ phase' = "done"
                 /\ UNCHANGED <<queuedMutation, executions>>
Fallback == /\ phase = "fallback" /\ executions' = executions + 1
            /\ phase' = "late" /\ UNCHANGED queuedMutation
LateCommand == /\ phase = "late" /\ phase' = "done"
               /\ executions' = IF queuedMutation THEN executions + 1 ELSE executions
               /\ UNCHANGED queuedMutation
Done == /\ phase = "done" /\ UNCHANGED vars
Next == Ready \/ NoPanel \/ Execute \/ StopUncertain \/ Fallback \/ LateCommand \/ Done
Spec == Init /\ [][Next]_vars
AtMostOneMutation == executions <= 1
NoQueuedFallbackMutation == phase \in {"fallback", "late"} => ~queuedMutation
====
