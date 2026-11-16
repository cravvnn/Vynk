---- MODULE Styles ----
\* sync.jsx setStyles, called by applyPath from applyAll or addLayer/applyTree.
\* main.js parks NEEDS_VIEWER results and retries after focus/viewer changes.
\* AE can ignore a removal even in the viewer. The host must acknowledge only
\* an exact applied set, including absence of unwanted styles. One unwanted
\* style, one request and one successful/ignored menu result. This checks the
\* result contract and cold menu registration (Beta needs Show Styles first),
\* not focus acquisition, numeric IDs, property values or eventual retry after
\* an ignored command. The real AE gate verifies those native primitives.
\* Pattern Overlay artwork preflights are single-call rejection/recognition
\* checks outside this menu abstraction; test-host-styles covers prop/upsert
\* preservation and the real-AE fixture checks existing artwork and rendering.
CONSTANTS CheckExact, WarmMenu
VARIABLES phase, applied, ignored, acknowledged, registered
vars == <<phase, applied, ignored, acknowledged, registered>>
Init == /\ phase = "prepare" /\ applied = TRUE /\ ignored \in BOOLEAN
        /\ acknowledged = FALSE /\ registered = FALSE
ShowStyles == /\ phase = "prepare" /\ phase' = "apply"
              /\ registered' = WarmMenu
              /\ UNCHANGED <<applied, ignored, acknowledged>>
SetStyles == /\ phase = "apply" /\ phase' = "done"
             /\ applied' = (ignored \/ ~registered)
             /\ acknowledged' = (~CheckExact \/ ~(ignored \/ ~registered))
             /\ UNCHANGED <<ignored, registered>>
Done == /\ phase = "done" /\ UNCHANGED vars
Next == ShowStyles \/ SetStyles \/ Done
Spec == Init /\ [][Next]_vars
AcknowledgedExactSet == acknowledged => ~applied
SupportedMenuAcknowledged == (phase = "done" /\ ~ignored) => acknowledged
====
