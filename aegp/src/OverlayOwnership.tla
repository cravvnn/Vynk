---- MODULE OverlayOwnership ----
\* Overlay.cpp and PluginMain.cpp: main idle hook publishes the SDK main HWND,
\* atomic g_aeWindow, aeHasFocus, WM_TIMER. Two AE processes with one eligible
\* main window each; foreground can change before or after either binds.
\* Callers: main idle hook and overlay timer thread; modeled. Legacy records
\* the removed global foreground/enumeration design. Window destruction/reuse,
\* visibility and Win32 geometry are excluded. Socket and
\* render thread lifecycles remain outside this spec; see SPECS.md.
EXTENDS FiniteSets
CONSTANTS Hosts, Windows, FirstHost, FirstWindow, None, Legacy
Owner(w) == IF w = FirstWindow THEN FirstHost ELSE CHOOSE h \in Hosts : h # FirstHost
VARIABLES bound, foreground
vars == <<bound, foreground>>

Init == /\ bound = [h \in Hosts |-> None] /\ foreground \in Windows

ForegroundWindow(h) ==
  /\ Legacy
  /\ bound[h] = None
  /\ (Legacy \/ Owner(foreground) = h)
  /\ bound' = [bound EXCEPT ![h] = foreground]
  /\ UNCHANGED foreground

EnumerateWindows(h, w) ==
  /\ Legacy
  /\ bound[h] = None
  /\ ~(Legacy \/ Owner(foreground) = h)
  /\ (Legacy \/ Owner(w) = h)
  /\ bound' = [bound EXCEPT ![h] = w]
  /\ UNCHANGED foreground

PublishSdkWindow(h, w) ==
  /\ ~Legacy
  /\ Owner(w) = h
  /\ bound' = [bound EXCEPT ![h] = w]
  /\ UNCHANGED foreground

MoveForeground(w) == /\ foreground' = w /\ UNCHANGED bound
Next == (\E h \in Hosts : ForegroundWindow(h))
     \/ (\E h \in Hosts, w \in Windows : EnumerateWindows(h, w))
     \/ (\E h \in Hosts, w \in Windows : PublishSdkWindow(h, w))
     \/ (\E w \in Windows : MoveForeground(w))
Spec == Init /\ [][Next]_vars
BoundToOwnWindow == \A h \in Hosts : bound[h] # None => Owner(bound[h]) = h
FocusIsLocal == \A h \in Hosts : (bound[h] # None /\ Owner(foreground) = Owner(bound[h])) => Owner(foreground) = h
====
