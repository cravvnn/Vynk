# AE2020 compatibility candidate

AE2020 (17.0) remains the minimum target. Native Release builds and CTest pass
against official Windows SDKs 25.2, 25.6, 26.5 and 27.0 with MSVC 19.44, Windows
SDK 10.0.26100 and CMake 4.5. This slice has not run in After Effects. Compilation,
mock-host and model checks do not establish host compatibility.

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
`api-compatibility.json` was checked against all four official Adobe Windows
SDKs downloaded through Developer Console. The earlier public-mirror check is
superseded by these declarations and native builds. No SDK headers are tracked
or redistributed.

`node tools/check-aegp-api.mjs` audits the source's suite acquisitions and used
members. Supplying `AE_GeneralPlug.h` and `AE_GeneralPlugOld.h` paths also compares
all 54 contracted parameter lists with those headers. This is a declaration
audit, not a compiler. The existing SDK-free C++ test covers script quoting and
passes both standalone and through the native project's CTest target.

SDK 25.2 emits two C4103 packing warnings from Adobe's utility/header includes.
The reference artifact uses SDK 25.6, which builds without warnings. Runtime ABI
and suite acquisition still require real AE tests.

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

Run forced native identity on both modern AE hosts, including the Curves
scenarios and create/reorder/delete cases, then the full pair suite and a real
AE2020 run. Compilation and CTest have passed; these host gates remain pending.
`state.nativeIdentity=true` forces the legacy route for the harness; native cycles
also refuse Layer.id fallback for layers created after capture, even on modern
hosts. Full-suite order enables this route for the animated custom-data cases.

Verify ExecuteScript sees the loaded JSX engine, returned UTF-8/memory-handle
lifetime, live layer-object equality, fresh bindings after undo/project switches,
custom-data write/readback, shared-base IDs, duplicate stamps, local locks and
independent playheads. The new scenarios are prepared, not run here.

New Pattern artwork transfer remains unsupported. Only controls and keys on
existing shared-base Pattern artwork are covered by the previous focused evidence.
