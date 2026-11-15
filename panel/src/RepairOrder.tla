---- MODULE RepairOrder ----
\* main.js answerNeed(full): identical per-layer hashes do not imply identical
\* comp order/settings. Concurrent insertions can produce equal layer contents
\* in reverse order after both relay messages are applied. A full repair must
\* include reorder/comp ops before deciding its response is empty.
\* One quiet requester/reference and successful atomic host apply. Observation
\* covers baseline and layer retention; Delivery covers response transport.
EXTENDS Naturals
CONSTANT ReplyMetadata
VARIABLES phase, order, settings, reply
vars == <<phase, order, settings, reply>>
Init == /\ phase = "need" /\ order = 1 /\ settings = 1 /\ reply = FALSE
AnswerNeed == /\ phase = "need" /\ phase' = "apply" /\ reply' = ReplyMetadata
              /\ UNCHANGED <<order, settings>>
Apply == /\ phase = "apply" /\ phase' = "done"
         /\ order' = IF reply THEN 0 ELSE order
         /\ settings' = IF reply THEN 0 ELSE settings
         /\ UNCHANGED reply
Done == /\ phase = "done" /\ UNCHANGED vars
Next == AnswerNeed \/ Apply \/ Done
Spec == Init /\ [][Next]_vars
FullRepairConverges == phase = "done" => (order = 0 /\ settings = 0)
====
