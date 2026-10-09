#pragma once

// Native AE access layer. Called only from the AEGP idle hook, i.e. on After
// Effects' main thread. Never call these from the bridge/network thread.
//
// Phase 1: read active comp identity (comp id|name), layer count, layer
// selection and project dirty flag natively, and emit COMP/SEL/DIRTY lines.
// No project mutation yet.

typedef void (*AeHostSink)(const char* line);

void AeHost_init(void* basicSuite, unsigned int pluginId, AeHostSink sink);
void AeHost_onIdle(long long nowMs);
void AeHost_shutdown();
