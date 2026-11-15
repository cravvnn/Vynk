---- MODULE Append ----
\* index.ts handleOp's writeChain, handleHello's barrier, closePeer/releaseRoom.
\* Two unique wire edits enter a serial append queue. Closing the last socket
\* can race writes and one new join. Append may fail; an unsuccessful write
\* must never be echoed or included in welcome. releaseRoom retains ownership
\* until the captured write chain drains; getRoom reserves the joining peer.
\* The disk interface reports append success or failure. fsync/power loss,
\* partial/corrupt files and process crashes are not modeled here. Delivery.tla
\* composes successful commits with panel storage/retry. Receipts.tla covers scans.
EXTENDS Sequences, FiniteSets, Naturals
CONSTANTS Ops, None, AppendBeforeEcho, DrainBeforeRelease, JoinBarrier
VARIABLES received, queue, writing, disk, published, failed, closed, closedOnce,
          joining, joinStarted, joinThrough, welcome, receipts, released,
          unsafeRelease
vars == <<received, queue, writing, disk, published, failed, closed, closedOnce,
          joining, joinStarted, joinThrough, welcome, receipts, released,
          unsafeRelease>>
Init ==
  /\ received = {} /\ queue = <<>> /\ writing = None /\ disk = <<>> /\ published = <<>>
  /\ failed = FALSE /\ closed = FALSE /\ closedOnce = FALSE
  /\ joining = FALSE /\ joinStarted = FALSE /\ joinThrough = {} /\ welcome = FALSE
  /\ receipts = {} /\ released = FALSE /\ unsafeRelease = FALSE
Values(s) == {s[i] : i \in 1..Len(s)}
HandleOp(o) ==
  /\ ~closed /\ ~failed /\ o \notin received
  /\ received' = received \cup {o} /\ queue' = Append(queue, o)
  /\ UNCHANGED <<writing, disk, published, failed, closed, closedOnce, joining,
                 joinStarted, joinThrough, welcome, receipts, released, unsafeRelease>>
AppendStart ==
  /\ ~failed /\ writing = None /\ Len(queue) > 0
  /\ writing' = Head(queue) /\ queue' = Tail(queue)
  /\ UNCHANGED <<received, disk, published, failed, closed, closedOnce, joining,
                 joinStarted, joinThrough, welcome, receipts, released, unsafeRelease>>
AppendSuccess ==
  /\ writing # None /\ writing \notin Values(disk)
  /\ disk' = Append(disk, writing)
  /\ UNCHANGED <<received, queue, writing, published, failed, closed, closedOnce,
                 joining, joinStarted, joinThrough, welcome, receipts, released, unsafeRelease>>
CommitBroadcast ==
  /\ writing # None /\ (~AppendBeforeEcho \/ writing \in Values(disk))
  /\ published' = Append(published, writing) /\ writing' = None
  /\ UNCHANGED <<received, queue, disk, failed, closed, closedOnce, joining,
                 joinStarted, joinThrough, welcome, receipts, released, unsafeRelease>>
AppendFailure ==
  /\ writing # None /\ writing \notin Values(disk)
  /\ writing' = None /\ queue' = <<>> /\ failed' = TRUE /\ closed' = TRUE
  /\ UNCHANGED <<received, disk, published, closedOnce, joining, joinStarted,
                 joinThrough, welcome, receipts, released, unsafeRelease>>
ClosePeer ==
  /\ ~closedOnce /\ ~closed
  /\ closed' = TRUE /\ closedOnce' = TRUE
  /\ UNCHANGED <<received, queue, writing, disk, published, failed, joining,
                 joinStarted, joinThrough, welcome, receipts, released, unsafeRelease>>
ReleaseRoom ==
  /\ closed /\ ~joining /\ ~released
  /\ (~DrainBeforeRelease \/ (Len(queue) = 0 /\ writing = None))
  /\ released' = TRUE
  /\ unsafeRelease' = (unsafeRelease \/ Len(queue) > 0 \/ writing # None)
  /\ UNCHANGED <<received, queue, writing, disk, published, failed, closed,
                 closedOnce, joining, joinStarted, joinThrough, welcome, receipts>>
GetRoom ==
  /\ closed /\ ~joinStarted
  /\ joining' = TRUE /\ joinStarted' = TRUE /\ joinThrough' = received
  /\ UNCHANGED <<received, queue, writing, disk, published, failed, closed,
                 closedOnce, welcome, receipts, released, unsafeRelease>>
HandleHello ==
  /\ joining /\ ~failed
  /\ (~JoinBarrier \/ joinThrough \subseteq Values(published))
  /\ receipts' = Values(published) /\ welcome' = TRUE
  /\ joining' = FALSE /\ closed' = FALSE /\ released' = FALSE
  /\ UNCHANGED <<received, queue, writing, disk, published, failed, closedOnce,
                 joinStarted, joinThrough, unsafeRelease>>
RefuseFailedJoin ==
  /\ joining /\ failed /\ joining' = FALSE
  /\ UNCHANGED <<received, queue, writing, disk, published, failed, closed,
                 closedOnce, joinStarted, joinThrough, welcome, receipts, released, unsafeRelease>>
Done == /\ (received = Ops \/ failed) /\ Len(queue) = 0 /\ writing = None /\ ~joining
        /\ UNCHANGED vars
Next == (\E o \in Ops : HandleOp(o)) \/ AppendStart \/ AppendSuccess \/ CommitBroadcast
     \/ AppendFailure \/ ClosePeer \/ ReleaseRoom \/ GetRoom \/ HandleHello \/ RefuseFailedJoin \/ Done
Spec == Init /\ [][Next]_vars
EchoOnlyWritten == Values(published) \subseteq Values(disk)
RelayOrder == \A i \in 1..Len(published) : published[i] = disk[i]
NoReleaseDuringWrite == ~unsafeRelease
WelcomeCoversEarlierFrames == welcome => joinThrough \subseteq receipts
====
