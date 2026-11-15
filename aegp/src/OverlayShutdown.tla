---- MODULE OverlayShutdown ----
\* Overlay.cpp findAeWindow/enumWindowsProc used GetWindowText from the overlay
\* thread. For an in-process window Win32 sends synchronous WM_GETTEXT. A live
\* WCT trace showed AE's main thread joining the overlay, which waited on that
\* same main thread via SendMessage. Overlay_stop's caller is DeathHook.
\* The new worker consumes the SDK HWND published by the main idle hook and
\* never sends the main thread a caption query. One lookup and one shutdown;
\* no sockets, drawing, or arbitrary effect data. See SPECS.md for exclusions.
VARIABLES main, worker
CONSTANT Legacy
vars == <<main, worker>>
Init == /\ main = "running" /\ worker = "lookup"
WindowLookup == /\ worker = "lookup"
                /\ worker' = IF Legacy THEN "wait-main" ELSE "idle"
                /\ UNCHANGED main
ReplyToCaption == /\ main = "running" /\ worker = "wait-main"
                  /\ worker' = "idle" /\ UNCHANGED main
OverlayStop == /\ main = "running" /\ main' = "joining" /\ UNCHANGED worker
WorkerExit == /\ main = "joining" /\ worker = "idle"
              /\ worker' = "exited" /\ UNCHANGED main
JoinCompletes == /\ main = "joining" /\ worker = "exited"
                 /\ main' = "exited" /\ UNCHANGED worker
Done == /\ main = "exited" /\ worker = "exited" /\ UNCHANGED vars
Next == WindowLookup \/ ReplyToCaption \/ OverlayStop \/ WorkerExit \/ JoinCompletes \/ Done
Spec == Init /\ [][Next]_vars /\ WF_vars(WindowLookup) /\ WF_vars(ReplyToCaption)
        /\ WF_vars(WorkerExit) /\ WF_vars(JoinCompletes)
ShutdownCompletes == (main = "joining") ~> (main = "exited")
====
