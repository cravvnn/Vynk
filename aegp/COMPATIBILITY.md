# AE2020 compatibility candidate

AE2020 (17.0) remains the minimum target. Native Release builds and CTest pass
against Windows SDKs 25.2, 25.6, 26.5 and 27.0 with MSVC 19.44, Windows
SDK 10.0.26100 and CMake 4.5. Twenty-four focused Curves/Pattern/identity cases pass
on AE 25.6 and 26.3. Animated Curves
used forced native identity. A further nine-case run enables native identity
before all five Pattern cases and checks the identity lifecycle. AE2020 runtime
testing remains on the compatibility checklist; SDK builds, mock-host checks and
models cover their individual contracts.

The companion now requests these older suites for the members it uses:

| Suite | SDK declaration baseline |
| --- | --- |
| LayerSuite8 | frozen AE12.0; layer enumeration, native IDs and lookup by ID |
| CompSuite10 | frozen AE12; comp lookup and selection collection |
| EffectSuite4 | frozen AE13.0; effect enumeration and disposal |
| StreamSuite5 | frozen AE15; arbitrary values and stream lifetime |

KeyframeSuite4, ItemSuite9, RenderSuite5 and UtilitySuite6 remain in use. The
[SDK guide](https://ae-plugins.docsforadobe.dev/aegps/aegp-suites/) documents the
native ID lookup, stream/keyframe APIs and synchronous script execution. The
[version guidance](https://ae-plugins.docsforadobe.dev/intro/compatibility-across-multiple-versions/)
requires testing each supported host. The declaration contract in
`api-compatibility.json` was checked against all four Adobe Windows
SDKs downloaded through Developer Console. The earlier public-mirror check is
superseded by these declarations and native builds. No SDK headers are tracked
or redistributed.

`node tools/check-aegp-api.mjs` audits the source's suite acquisitions and used
members. Supplying `AE_GeneralPlug.h` and `AE_GeneralPlugOld.h` paths also compares
all 54 contracted parameter lists with those headers. This is a declaration
audit, not a compiler. The SDK-free C++ test covers script quoting, result/error
handle decoding and ownership, including a successful result with an allocated
empty error handle. It passes through each native project's CTest target.

SDK 25.2 emits two C4103 packing warnings from Adobe's utility/header includes.
The reference artifact uses SDK 25.6, which builds without warnings. Runtime ABI
and suite acquisition are part of the supported-version test matrix.

## Identity before Layer.id

Layer.id is absent before AE22. The panel uses `ARBCYCLE` on those hosts; AE22+
keeps its direct JSX cycle. The native command enumerates current comp/item and
layer IDs, then calls `vynkSync.cycleNative` through UtilitySuite6 ExecuteScript
on the same main thread. JSX binds those IDs to the live layer objects for that
call and clears the table in `finally`. Native and JSX retain no binding cache.

Enumeration positions only correlate native IDs and live objects inside that
synchronous command. Operations still target SIDs. Base objects retain `id<n>`;
created layers retain comment stamps and base aliases. Missing Layer.id never
causes the reader to independently stamp an existing shared-base layer.

Remote adds can create layers after capture. A second fresh enumeration and
read-only script refresh their local native IDs before post-host custom-data
writes. If that refresh fails, the command preserves the applied-prefix receipts;
missing addresses fail the custom-data phase. It must not replay a successful
host prefix merely because its ID refresh failed. Arbitrary-data validation,
layer-relative rational times, verified writes/rollback and playheads are unchanged.

AE17–21 requires the updated companion for safe identity. Missing/older companions
leave the cycle pending, and a direct legacy JSX call rejects missing native
identity before setters or stamps. Lite snapshots never restore IDs from shadows.

## Pending host gates

The focused runs pass with matching dumps, empty queues/outboxes and zero apply
failures. They cover unchanged shared-base comments, independent playheads, add,
reorder, delete, animated custom data including a locked peer, and existing-base
Pattern controls/keys with matching rendered pixels.
Those runs exposed an allocated empty ExecuteScript error handle on success;
the companion now checks its contents and frees both returned handles. Script
failures include a bounded diagnostic. The results cover the named scenarios
and versions above.

The full 113-case attempt completed 82 cases (80 passes, two failures), then
stopped on an asynchronous PNG export receipt race. The receipt race is fixed
and both focused rendered-pixel checks pass. Newer-only text and camera defaults
in AE26.3 remain different from AE25.6. There is no complete full-suite pass.
Complete the pair suite and the AE2020 runtime matrix before a stable release.
`state.nativeIdentity=true` forces the legacy route for the harness; native cycles
also refuse Layer.id fallback for layers created after capture, even on modern
hosts. Full-suite order enables this route for the animated custom-data cases.

Verify ExecuteScript sees the loaded JSX engine, returned UTF-8/memory-handle
lifetime, live layer-object equality, fresh bindings after undo/project switches,
custom-data write/readback, shared-base IDs, duplicate stamps, local locks and
independent playheads. Focused identity checks cover only their named surfaces.

New Pattern artwork transfer remains unsupported. Only controls and keys on
existing shared-base Pattern artwork are covered by the focused evidence.
