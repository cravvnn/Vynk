---- MODULE Session ----
\* main.js: connect/disconnect, socket open/hello/message/close callbacks,
\* persist/load/flushOutbox. Callers: join/leave, automatic reconnect, delayed
\* host-info callback, delayed WS callbacks. All are represented below.
\* Starts with a persisted-room edit queued offline. Two successive sockets
\* may address either of two rooms; their callbacks can arrive between steps.
\* The relay interface delivers a welcome only after that socket's hello and
\* tags incoming ops with its joined room. The host interface consumes only
\* accepted messages; leaked tracks wrongly routed sends or host deliveries.
\* Left out: op values/ordering, durable ACKs (Delivery.tla), HTTP callbacks, native requests,
\* project reads and self-repair. These remain gaps listed in SPECS.md.
EXTENDS FiniteSets
CONSTANTS Sockets, Rooms, FirstRoom, None, Legacy
VARIABLES active, chosen, room, used, opened, helloReady, helloSent, welcomed,
          closed, connected, outbox, stored, leaked, socketRooms
vars == <<active, chosen, room, used, opened, helloReady, helloSent, welcomed,
          closed, connected, outbox, stored, leaked, socketRooms>>
Current(s) == Legacy \/ s = active

Init ==
  /\ active = None /\ chosen = None /\ room = FirstRoom
  /\ used = {} /\ opened = {} /\ helloReady = {} /\ helloSent = {}
  /\ welcomed = {} /\ closed = {} /\ connected = FALSE
  /\ outbox = {FirstRoom} /\ stored = [r \in Rooms |-> {}]
  /\ leaked = FALSE
  /\ socketRooms = [s \in Sockets |-> FirstRoom]

Connect(s, r) ==
  /\ s \notin used
  /\ active' = s /\ chosen' = s /\ room' = r /\ used' = used \cup {s}
  /\ socketRooms' = [socketRooms EXCEPT ![s] = r]
  /\ connected' = IF Legacy THEN connected ELSE FALSE
  /\ IF ~Legacy /\ room # r
       THEN /\ stored' = [stored EXCEPT ![room] = outbox]
            /\ outbox' = stored[r]
       ELSE UNCHANGED <<stored, outbox>>
  /\ UNCHANGED <<opened, helloReady, helloSent, welcomed, closed, leaked>>

OnOpen(s) ==
  /\ s \in used /\ s \notin opened /\ s \notin closed
  /\ opened' = opened \cup {s}
  /\ helloReady' = IF Current(s) THEN helloReady \cup {s} ELSE helloReady
  /\ UNCHANGED <<active, chosen, room, used, helloSent, welcomed, closed,
                 connected, outbox, stored, leaked, socketRooms>>

SendHello(s) ==
  /\ s \in helloReady
  /\ helloReady' = helloReady \ {s}
  /\ IF Current(s) /\ active \in opened /\ active \notin closed
       THEN /\ helloSent' = helloSent \cup {active}
            /\ leaked' = (leaked \/ socketRooms[s] # socketRooms[active])
       ELSE UNCHANGED <<helloSent, leaked>>
  /\ UNCHANGED <<active, chosen, room, used, opened, welcomed, closed,
                 connected, outbox, stored, socketRooms>>

OnWelcome(s) ==
  /\ s \in helloSent /\ s \notin welcomed /\ s \notin closed
  /\ welcomed' = welcomed \cup {s}
  /\ IF Current(s)
       THEN /\ connected' = TRUE
            /\ leaked' = (leaked \/ socketRooms[s] # room \/ (\E r \in outbox : r # room))
            /\ UNCHANGED outbox
       ELSE UNCHANGED <<connected, leaked, outbox>>
  /\ UNCHANGED <<active, chosen, room, used, opened, helloReady, helloSent,
                 closed, stored, socketRooms>>

OnClose(s) ==
  /\ s \in used /\ s \notin closed
  /\ closed' = closed \cup {s}
  /\ IF Current(s)
       THEN /\ connected' = FALSE
            /\ active' = IF Legacy THEN active ELSE None
       ELSE UNCHANGED <<connected, active>>
  /\ UNCHANGED <<chosen, room, used, opened, helloReady, helloSent, welcomed,
                 outbox, stored, leaked, socketRooms>>

Done == /\ used = Sockets /\ closed = Sockets /\ helloReady = {} /\ UNCHANGED vars
Next == (\E s \in Sockets, r \in Rooms : Connect(s, r))
     \/ (\E s \in Sockets : OnOpen(s) \/ SendHello(s) \/ OnWelcome(s) \/ OnClose(s)) \/ Done
Spec == Init /\ [][Next]_vars

NoCrossRoomTraffic == ~leaked
CurrentWelcomeSurvivesOldClose == chosen \in welcomed /\ chosen \notin closed => (connected /\ active = chosen)
====
