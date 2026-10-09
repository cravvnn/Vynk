#include "AeHost.h"

#include "AEConfig.h"
#ifdef AE_OS_WIN
#include <windows.h>
#endif
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include <AEGP_SuiteHandler.h>

#include <cstdio>
#include <cstring>
#include <string>

namespace {

AeHostSink g_sink = nullptr;
SPBasicSuite* g_basic = nullptr;
AEGP_PluginID g_pluginId = 0;
AEGP_SuiteHandler* g_suites = nullptr;

// Native reads run on AE's main thread; keep the rate low so the UI is never
// starved. 1000ms is plenty for Phase 1 (identity/selection/dirty).
constexpr long long kPollIntervalMs = 1000;
constexpr long long kHeartbeatMs = 5000;

long long g_lastPollMs = 0;
long long g_lastHeartbeatMs = 0;

std::string g_lastCompKey;
long g_lastNumLayers = -1;
std::string g_lastSel;
int g_lastDirty = -1;

// Project render timestamp: bumps on any project touch that affects rendering.
// Cheapest reliable native "something changed" signal.
AEGP_RenderSuite5* g_renderSuite = nullptr;
AEGP_TimeStamp g_lastStamp;
bool g_haveStamp = false;

void emit(const std::string& line) {
  if (g_sink) g_sink(line.c_str());
}

void logLine(const char* msg) {
  OutputDebugStringA("[vynk] ");
  OutputDebugStringA(msg);
  OutputDebugStringA("\n");
}

// Strip the characters that would break the tab/semicolon line protocol.
std::string sanitize(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  for (char c : in) {
    if (c == '\t' || c == '\n' || c == '\r' || c == ';') out.push_back(' ');
    else out.push_back(c);
  }
  return out;
}

std::string utf16ToUtf8(const A_UTF16Char* w) {
  if (!w) return std::string();
  const wchar_t* ws = reinterpret_cast<const wchar_t*>(w);
  int wlen = static_cast<int>(wcslen(ws));
  if (wlen <= 0) return std::string();
  int len = WideCharToMultiByte(CP_UTF8, 0, ws, wlen, nullptr, 0, nullptr, nullptr);
  if (len <= 0) return std::string();
  std::string out(static_cast<size_t>(len), '\0');
  WideCharToMultiByte(CP_UTF8, 0, ws, wlen, &out[0], len, nullptr, nullptr);
  return out;
}

std::string itemName(AEGP_ItemH itemH) {
  AEGP_MemHandle memH = nullptr;
  if (g_suites->ItemSuite9()->AEGP_GetItemName(g_pluginId, itemH, &memH) || !memH) return std::string();
  std::string name;
  A_UTF16Char* ptr = nullptr;
  if (!g_suites->MemorySuite1()->AEGP_LockMemHandle(memH, reinterpret_cast<void**>(&ptr)) && ptr) {
    name = utf16ToUtf8(ptr);
    g_suites->MemorySuite1()->AEGP_UnlockMemHandle(memH);
  }
  g_suites->MemorySuite1()->AEGP_FreeMemHandle(memH);
  return name;
}

void pollTimestamp() {
  if (!g_renderSuite) return;
  AEGP_TimeStamp ts;
  AEFX_CLR_STRUCT(ts);
  if (g_renderSuite->AEGP_GetCurrentTimestamp(&ts)) return;
  if (!g_haveStamp) {
    g_lastStamp = ts;
    g_haveStamp = true;
    return;
  }
  if (memcmp(ts.a, g_lastStamp.a, sizeof(ts.a)) == 0) return;
  g_lastStamp = ts;
  emit("CHANGED");
}

void pollProjectDirty() {
  AEGP_ProjectH projH = nullptr;
  if (g_suites->ProjSuite6()->AEGP_GetProjectByIndex(0, &projH) || !projH) return;
  A_Boolean dirtyB = FALSE;
  if (g_suites->ProjSuite6()->AEGP_ProjectIsDirty(projH, &dirtyB)) return;
  int dirty = dirtyB ? 1 : 0;
  if (dirty == g_lastDirty) return;
  g_lastDirty = dirty;
  char buf[32];
  sprintf_s(buf, "DIRTY\t%d", dirty);
  emit(buf);
}

void pollActiveComp() {
  AEGP_ItemH itemH = nullptr;
  if (g_suites->ItemSuite9()->AEGP_GetActiveItem(&itemH) || !itemH) return;

  AEGP_ItemType type = AEGP_ItemType_NONE;
  if (g_suites->ItemSuite9()->AEGP_GetItemType(itemH, &type) || type != AEGP_ItemType_COMP) return;

  A_long itemId = 0;
  if (g_suites->ItemSuite9()->AEGP_GetItemID(itemH, &itemId)) return;

  char keyBuf[320];
  sprintf_s(keyBuf, "%ld|%s", itemId, sanitize(itemName(itemH)).c_str());
  std::string compKey(keyBuf);

  AEGP_CompH compH = nullptr;
  if (g_suites->CompSuite12()->AEGP_GetCompFromItem(itemH, &compH) || !compH) return;

  A_long numLayers = 0;
  g_suites->LayerSuite9()->AEGP_GetCompNumLayers(compH, &numLayers);

  // Layer selection via collection (no index-array API exists).
  std::string sel;
  AEGP_Collection2H collH = nullptr;
  if (!g_suites->CompSuite12()->AEGP_GetNewCollectionFromCompSelection(g_pluginId, compH, &collH) &&
      collH) {
    A_u_long n = 0;
    g_suites->CollectionSuite2()->AEGP_GetCollectionNumItems(collH, &n);
    for (A_u_long i = 0; i < n; i++) {
      AEGP_CollectionItemV2 ci;
      AEFX_CLR_STRUCT(ci);
      if (g_suites->CollectionSuite2()->AEGP_GetCollectionItemByIndex(collH, i, &ci)) continue;
      if (ci.type != AEGP_CollectionItemType_LAYER) continue;
      AEGP_LayerIDVal idv = 0;
      if (g_suites->LayerSuite9()->AEGP_GetLayerID(ci.u.layer.layerH, &idv)) continue;
      char b[32];
      sprintf_s(b, "%ld", idv);
      if (!sel.empty()) sel += ",";
      sel += b;
    }
    g_suites->CollectionSuite2()->AEGP_DisposeCollection(collH);
  }

  if (compKey == g_lastCompKey && numLayers == g_lastNumLayers && sel == g_lastSel) return;
  g_lastCompKey = compKey;
  g_lastNumLayers = numLayers;
  g_lastSel = sel;

  char out[640];
  sprintf_s(out, "COMP\t%s\t%ld", compKey.c_str(), numLayers);
  emit(out);
  sprintf_s(out, "SEL\t%s\t%s", compKey.c_str(), sel.c_str());
  emit(out);
}

}  // namespace

void AeHost_init(void* basicSuite, unsigned int pluginId, AeHostSink sink) {
  g_basic = static_cast<SPBasicSuite*>(basicSuite);
  g_pluginId = static_cast<AEGP_PluginID>(pluginId);
  g_sink = sink;
  if (g_basic) {
    g_suites = new AEGP_SuiteHandler(g_basic);
    const void* suiteP = nullptr;
    if (!g_basic->AcquireSuite(kAEGPRenderSuite, kAEGPRenderSuiteVersion5, &suiteP)) {
      g_renderSuite = reinterpret_cast<AEGP_RenderSuite5*>(const_cast<void*>(suiteP));
    }
  }
  logLine("host init (phase 2)");
}

void AeHost_onIdle(long long nowMs) {
  if (!g_suites) return;

  // Timestamp check is a 4-byte read, so run it every idle call (~4x/s given
  // the 250ms sleep hint) for responsive change detection.
  try {
    pollTimestamp();
  } catch (...) {
  }

  // The heavier reads (item name/collection) run at the slower cadence.
  if (nowMs - g_lastPollMs >= kPollIntervalMs) {
    g_lastPollMs = nowMs;
    try {
      pollProjectDirty();
      pollActiveComp();
    } catch (...) {
      // Never let a read take down AE.
    }
  }

  if (nowMs - g_lastHeartbeatMs >= kHeartbeatMs) {
    g_lastHeartbeatMs = nowMs;
    logLine("idle heartbeat");
  }
}

void AeHost_shutdown() {
  if (g_basic && g_renderSuite) {
    g_basic->ReleaseSuite(kAEGPRenderSuite, kAEGPRenderSuiteVersion5);
    g_renderSuite = nullptr;
  }
  delete g_suites;
  g_suites = nullptr;
  logLine("host shutdown");
}
