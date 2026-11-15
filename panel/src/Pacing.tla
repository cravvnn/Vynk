---- MODULE Pacing ----
\* main.js flushOutbox, called by send, welcome and its later timer. Scale the
\* 40-frame/200ms budget to two frames per tick. A relay window may overlap six
\* panel windows; reserve two further messages for hello/log/cursor traffic.
\* This is a bounded pacing contract, not a model of wall clocks or all control
\* producers. The actual 450-edit private-relay test also runs real timers.
\* Delivery.tla covers ACK retention independently of delays between sends.
EXTENDS Naturals
CONSTANTS Paced
VARIABLES remaining, budget, relay, tick, rejected
vars == <<remaining, budget, relay, tick, rejected>>
Init == /\ remaining = 15 /\ budget = 0 /\ relay = 2 /\ tick = 0 /\ rejected = FALSE
FlushOutbox ==
  /\ remaining > 0 /\ (~Paced \/ budget < 2)
  /\ remaining' = remaining - 1 /\ budget' = budget + 1 /\ relay' = relay + 1
  /\ rejected' = (rejected \/ relay + 1 > 14)
  /\ UNCHANGED tick
Timer ==
  /\ tick' = IF tick = 5 THEN 0 ELSE tick + 1
  /\ relay' = IF tick = 5 THEN 2 ELSE relay
  /\ budget' = 0
  /\ UNCHANGED <<remaining, rejected>>
Next == FlushOutbox \/ Timer
Spec == Init /\ [][Next]_vars
NoRateDisconnect == ~rejected
====
