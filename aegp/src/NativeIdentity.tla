---- MODULE NativeIdentity ----
\* AeHost cmdNativeCycle -> synchronous ExecuteScript -> JSX cycleNative.
\* One shared SID can have a different native ID in either project. External
\* reorder/delete/project changes occur between main-thread commands only.
\* Bindings are command-local, and a failed post-create ID refresh must keep
\* the host's successful-prefix receipts. Requests covers async panel ownership.
\* Compact/pretty valid JSON are opaque return formats. Release includes pure
\* one-line framing inside this same command; byte/string guards are C++ tests.
\* SDK signatures, JS host-object equality, UTF-8 and native ID lifetime require
\* SDK compilation and real AE, including AE2020; they are not proved here.
EXTENDS Naturals
VARIABLES phase, project, exists, binding, applied, receipt, refresh, format
vars == <<phase, project, exists, binding, applied, receipt, refresh, format>>
Init == /\ phase = "idle" /\ project \in {1, 2} /\ exists \in BOOLEAN
        /\ binding = 0 /\ applied = 0 /\ receipt = "none" /\ refresh \in BOOLEAN
        /\ format \in {"compact", "pretty"}
ExternalChange == /\ phase = "idle" /\ project' = 3 - project /\ exists' \in BOOLEAN
                  /\ UNCHANGED <<phase, binding, applied, receipt, refresh, format>>
Capture == /\ phase = "idle" /\ phase' = "bound" /\ binding' = project
           /\ UNCHANGED <<project, exists, applied, receipt, refresh, format>>
Apply == /\ phase = "bound" /\ phase' = "applied"
         /\ applied' = IF exists THEN binding ELSE 0
         /\ receipt' = IF exists THEN "ok" ELSE "error"
         /\ UNCHANGED <<project, exists, binding, refresh, format>>
Release == /\ phase = "applied" /\ phase' = "done" /\ binding' = 0
           /\ receipt' = receipt
           /\ UNCHANGED <<project, exists, applied, refresh, format>>
Done == /\ phase = "done" /\ UNCHANGED vars
Next == ExternalChange \/ Capture \/ Apply \/ Release \/ Done
Spec == Init /\ [][Next]_vars
FreshBinding == binding # 0 => binding = project
NoStaleWrite == applied # 0 => applied = project
NoRetainedBindings == phase = "done" => binding = 0
ReceiptsSurviveRefresh == phase = "done" => receipt = IF exists THEN "ok" ELSE "error"
====
