---- MODULE BaseCapture ----
\* main.js shareBase/checkBaseJob/captureBaseScript/uploadBase. The sync/relay
\* interface supplies an observed project and a known applied prefix after a
\* quiet full read. A UI edit or project switch can precede the posted script;
\* save+copy is one AE main-thread step. User saves may replace the source file
\* during upload. BaseCheckpoint.tla consumes the immutable copy/prefix pair.
\* Delivery/Requests cover transport and stale callbacks. File API behavior,
\* failed AE applies, property contents and disk errors require runtime tests.
EXTENDS Naturals
CONSTANTS RevisionGuard, FileGuard, SaveCurrent, PrivateCopy
VARIABLES phase, project, revision, known, prefix, disk, copy, captured,
          guardRevision, pending, changed, file, switched, published, wrongSave
vars == <<phase, project, revision, known, prefix, disk, copy, captured,
          guardRevision, pending, changed, file, switched, published, wrongSave>>
Init == /\ phase = "wait" /\ project = 1 /\ revision = 1 /\ known = 1 /\ prefix = 1
        /\ disk = 0 /\ copy = 0 /\ captured = 0 /\ guardRevision = 0
        /\ pending = FALSE /\ changed = FALSE /\ file = "original" /\ switched = FALSE
        /\ published = 0 /\ wrongSave = FALSE
LocalEdit ==
  /\ ~changed /\ phase \in {"wait", "saving", "upload"}
  /\ project' = 2 /\ revision' = revision + 1 /\ pending' = TRUE /\ changed' = TRUE
  /\ UNCHANGED <<phase, known, prefix, disk, copy, captured, guardRevision, file, switched, published, wrongSave>>
ObserveAndCommit ==
  /\ pending /\ phase = "wait" /\ file = "original"
  /\ known' = revision /\ prefix' = project /\ pending' = FALSE
  /\ UNCHANGED <<phase, project, revision, disk, copy, captured, guardRevision,
                 changed, file, switched, published, wrongSave>>
BeginCapture ==
  /\ phase = "wait" /\ ~pending /\ known = revision /\ project = prefix
  /\ captured' = prefix /\ guardRevision' = known /\ phase' = "saving"
  /\ UNCHANGED <<project, revision, known, prefix, disk, copy, pending, changed,
                 file, switched, published, wrongSave>>
SwitchProject ==
  /\ ~switched /\ phase \in {"saving", "upload"}
  /\ file' = "other" /\ project' = 2 /\ switched' = TRUE
  /\ UNCHANGED <<phase, revision, known, prefix, disk, copy, captured,
                 guardRevision, pending, changed, published, wrongSave>>
CaptureValue == IF SaveCurrent THEN project ELSE disk
SaveCopy ==
  /\ phase = "saving"
  /\ IF FileGuard /\ file # "original"
       THEN /\ phase' = "cancelled" /\ UNCHANGED <<disk, copy, wrongSave>>
       ELSE IF RevisionGuard /\ revision # guardRevision
         THEN /\ phase' = "wait" /\ UNCHANGED <<disk, copy, wrongSave>>
         ELSE /\ phase' = "upload" /\ disk' = CaptureValue /\ copy' = CaptureValue
              /\ wrongSave' = (wrongSave \/ file # "original")
  /\ UNCHANGED <<project, revision, known, prefix, captured, guardRevision,
                 pending, changed, file, switched, published>>
UserSave == /\ phase = "upload" /\ disk # project /\ disk' = project
            /\ UNCHANGED <<phase, project, revision, known, prefix, copy, captured,
                           guardRevision, pending, changed, file, switched, published, wrongSave>>
FinishUpload ==
  /\ phase = "upload" /\ phase' = "done"
  /\ published' = IF PrivateCopy THEN copy ELSE disk
  /\ UNCHANGED <<project, revision, known, prefix, disk, copy, captured, guardRevision,
                 pending, changed, file, switched, wrongSave>>
Done == /\ phase \in {"done", "cancelled"} /\ UNCHANGED vars
Next == LocalEdit \/ ObserveAndCommit \/ BeginCapture \/ SwitchProject \/ SaveCopy \/ UserSave \/ FinishUpload \/ Done
Spec == Init /\ [][Next]_vars
SnapshotMatchesCheckpoint == phase = "done" => published = captured
NoOtherProjectSave == ~wrongSave
====
