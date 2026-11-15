---- MODULE Requests ----
\* main.js fetchMissingHistory/shareBase/getBase callbacks use requestContext:
\* current socket + shadow object + project path. A reconnect, room switch or
\* resetBaselines invalidates that context and pollGeneration for AE/native
\* reads. busy represents fetchingHistory or cycleBusy. The callback validates
\* before changing either data or busy. Caller starts work, leaves the UI
\* usable, then the callback may arrive before/after a newer request.
\* Two requests, one context change. busy models history's fetchingHistory;
\* data writes also stand for replacing base metadata or dispatching app.open.
\* Dispatch after successful validation is atomic on the browser JS thread.
\* File bytes, AE execution after dispatch, and server/base revision changes
\* are excluded; see SPECS.md. Legacy models the original unguarded callbacks.
EXTENDS FiniteSets
CONSTANTS Jobs, First, Second, None, Legacy, EarlyReset
VARIABLES context, started, completed, origin, busy, wrongData, wrongReset
vars == <<context, started, completed, origin, busy, wrongData, wrongReset>>
Init == /\ context = First /\ started = {} /\ completed = {}
        /\ origin = [j \in Jobs |-> None] /\ busy = None
        /\ wrongData = FALSE /\ wrongReset = FALSE
StartRequest(j) ==
  /\ j \notin started /\ busy = None
  /\ started' = started \cup {j}
  /\ origin' = [origin EXCEPT ![j] = context]
  /\ busy' = j
  /\ UNCHANGED <<context, completed, wrongData, wrongReset>>
ChangeContext ==
  /\ context = First /\ context' = Second /\ busy' = None
  /\ UNCHANGED <<started, completed, origin, wrongData, wrongReset>>
CompleteRequest(j) ==
  /\ j \in started /\ j \notin completed
  /\ completed' = completed \cup {j}
  /\ IF Legacy \/ EarlyReset \/ origin[j] = context
       THEN /\ wrongReset' = (wrongReset \/ (busy # None /\ busy # j))
            /\ busy' = None
       ELSE UNCHANGED <<wrongReset, busy>>
  /\ IF Legacy \/ origin[j] = context
       THEN wrongData' = (wrongData \/ origin[j] # context)
       ELSE UNCHANGED wrongData
  /\ UNCHANGED <<context, started, origin>>
Done == /\ completed = Jobs /\ UNCHANGED vars
Next == (\E j \in Jobs : StartRequest(j) \/ CompleteRequest(j)) \/ ChangeContext \/ Done
Spec == Init /\ [][Next]_vars
NoWrongContextData == ~wrongData
NoReplacementRequestReset == ~wrongReset
====
