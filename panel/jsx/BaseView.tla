---- MODULE BaseView ----
\* sync.jsx openBase, called synchronously by main.js openBaseScript. BaseOpen
\* supplies the confirmed file/revision guard and posted-job lifecycle. One host
\* call captures local times, opens the snapshot and restores by sidOf identity.
\* The downloaded comp order differs and contains a new comp. A local seek can
\* precede or follow that atomic call. No view state enters the relay interface.
\* Assumes successful native setters; actual failures are counted in the result.
EXTENDS Naturals
CONSTANTS PreserveLocal, MatchIdentity, ClearNew
VARIABLES localTimes, times, opened, sought
vars == <<localTimes, times, opened, sought>>
Ids == {"a", "b", "c"}
Provider == [i \in Ids |-> IF i = "a" THEN 1 ELSE IF i = "b" THEN 3 ELSE 5]
Init == /\ localTimes = [i \in {"a", "b"} |-> IF i = "a" THEN 2 ELSE 4]
        /\ times = [i \in Ids |-> IF i = "a" THEN 2 ELSE IF i = "b" THEN 4 ELSE 0]
        /\ opened = FALSE /\ sought = FALSE
Seek == /\ ~sought /\ sought' = TRUE
        /\ localTimes' = [localTimes EXCEPT !["a"] = 4]
        /\ times' = [times EXCEPT !["a"] = 4]
        /\ UNCHANGED opened
OpenBase ==
  /\ ~opened /\ opened' = TRUE
  /\ times' = [i \in Ids |-> IF ~PreserveLocal THEN Provider[i]
       ELSE IF i = "c" THEN IF ClearNew THEN 0 ELSE Provider[i]
       ELSE localTimes[IF MatchIdentity THEN i ELSE IF i = "a" THEN "b" ELSE "a"]]
  /\ UNCHANGED <<localTimes, sought>>
Done == /\ opened /\ sought /\ UNCHANGED vars
Next == Seek \/ OpenBase \/ Done
Spec == Init /\ [][Next]_vars
LocalTimesKept == opened => \A i \in {"a", "b"} : times[i] = localTimes[i]
NewCompStartsLocally == opened => times["c"] = 0
====
