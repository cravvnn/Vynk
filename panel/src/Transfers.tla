---- MODULE Transfers ----
\* main.js: readHttpResponse, httpPutFile, httpGetText, httpGetToFile and their
\* shared done/finished convention. One HTTP response either ends or aborts;
\* a file write finishes after a complete response. A late request error may
\* arrive after completion. Each JS event handler is one atomic action.
\* Callers shareBase/getBase/fetchMissingHistory are composed through Requests.
\* Network bytes, source-file errors and OS file-close errors are excluded.
EXTENDS Naturals
CONSTANTS FileMode, Legacy, Guard
VARIABLES network, disk, result, callbacks, lateError
vars == <<network, disk, result, callbacks, lateError>>
Init == /\ network = "waiting" /\ disk = "waiting"
        /\ result = "pending" /\ callbacks = 0 /\ lateError = FALSE
Complete(value) ==
  /\ callbacks < 2
  /\ IF Guard /\ result # "pending"
       THEN UNCHANGED <<result, callbacks>>
       ELSE /\ result' = value /\ callbacks' = callbacks + 1
ResponseEnd ==
  /\ network = "waiting" /\ network' = "complete"
  /\ IF FileMode THEN UNCHANGED <<result, callbacks>> ELSE Complete("ok")
  /\ UNCHANGED <<disk, lateError>>
ResponseAbort ==
  /\ network = "waiting" /\ network' = "aborted"
  /\ UNCHANGED <<disk, result, callbacks, lateError>>
HandleAbort ==
  /\ ~Legacy /\ network = "aborted" /\ result = "pending"
  /\ Complete("error") /\ UNCHANGED <<network, disk, lateError>>
FileFinish ==
  /\ FileMode /\ network = "complete" /\ disk = "waiting"
  /\ disk' = "complete" /\ Complete("ok") /\ UNCHANGED <<network, lateError>>
LateRequestError ==
  /\ network = "complete" /\ ~lateError /\ lateError' = TRUE
  /\ Complete("error") /\ UNCHANGED <<network, disk>>
Done == /\ result # "pending" /\ UNCHANGED vars
Next == ResponseEnd \/ ResponseAbort \/ HandleAbort \/ FileFinish \/ LateRequestError \/ Done
Spec == Init /\ [][Next]_vars /\ WF_vars(HandleAbort) /\ WF_vars(FileFinish)
CallbackOnce == callbacks <= 1
NoPartialSuccess == result = "ok" => (network = "complete" /\ (~FileMode \/ disk = "complete"))
TransferSettles == (network # "waiting") ~> (result # "pending")
====
