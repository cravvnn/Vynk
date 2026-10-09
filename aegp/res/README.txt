Resources (PiPL) — intentionally not faked
===========================================

An AEGP needs a PiPL resource so After Effects will load it. PiPL syntax is
finicky and version-specific, and the After Effects SDK ships a working sample,
so rather than invent it here:

1. Copy the `.r` (PiPL) and `.rc` from an SDK AEGP sample, e.g.
   `Examples/AEGP/Skeleton/` in the extracted SDK.
2. Replace the plugin name / category / entry-point symbol with ours
   (`EntryPointFunc`, "Vynk").
3. Build the PiPL with the SDK's PiPL tool (see the SDK sample's build steps),
   and add the resulting `.rc` to the CMake target sources.

Do this the first time you have the SDK in hand, then wire it into
`aegp/CMakeLists.txt` (add the `.rc` to the `add_library(...)` list).
