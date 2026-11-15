#include "AeHost.h"

#include "AEConfig.h"
#ifdef AE_OS_WIN
#include <windows.h>
#endif
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include <AEGP_SuiteHandler.h>

#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <vector>
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

// ---------------------------------------------------------------------------
// Custom-data effect parameters (Curves and similar "arbitrary data" params)
// are invisible to ExtendScript. The panel reads and writes them here, as hex.
//
//   panel -> ARBGET \t req \t compItemId \t layerId
//   AEGP  -> ARB    \t req \t ok \t fx:param:size:hex;...     (fx 1-based, K = keyframed)
//   panel -> ARBSET \t req \t compItemId \t layerId \t fx \t param \t hex
//   AEGP  -> ARBOK  \t req \t ok | err:<reason>

std::mutex g_cmdMutex;
std::vector<std::string> g_cmds;

std::vector<std::string> splitTabs(const std::string& line) {
  std::vector<std::string> out;
  size_t start = 0;
  for (;;) {
    size_t tab = line.find('\t', start);
    out.push_back(line.substr(start, tab == std::string::npos ? std::string::npos : tab - start));
    if (tab == std::string::npos) break;
    start = tab + 1;
  }
  return out;
}

AEGP_CompH findCompByItemId(A_long wantId) {
  AEGP_ProjectH projH = nullptr;
  if (g_suites->ProjSuite6()->AEGP_GetProjectByIndex(0, &projH) || !projH) return nullptr;
  AEGP_ItemH itemH = nullptr;
  if (g_suites->ItemSuite9()->AEGP_GetFirstProjItem(projH, &itemH)) return nullptr;
  while (itemH) {
    A_long id = 0;
    AEGP_ItemType type = AEGP_ItemType_NONE;
    g_suites->ItemSuite9()->AEGP_GetItemID(itemH, &id);
    g_suites->ItemSuite9()->AEGP_GetItemType(itemH, &type);
    if (id == wantId && type == AEGP_ItemType_COMP) {
      AEGP_CompH compH = nullptr;
      if (!g_suites->CompSuite12()->AEGP_GetCompFromItem(itemH, &compH)) return compH;
      return nullptr;
    }
    AEGP_ItemH next = nullptr;
    if (g_suites->ItemSuite9()->AEGP_GetNextProjItem(projH, itemH, &next)) break;
    itemH = next;
  }
  return nullptr;
}

AEGP_LayerH findLayerById(AEGP_CompH compH, A_long wantId) {
  A_long n = 0;
  g_suites->LayerSuite9()->AEGP_GetCompNumLayers(compH, &n);
  for (A_long i = 0; i < n; i++) {
    AEGP_LayerH layerH = nullptr;
    if (g_suites->LayerSuite9()->AEGP_GetCompLayerByIndex(compH, i, &layerH) || !layerH) continue;
    AEGP_LayerIDVal id = 0;
    if (!g_suites->LayerSuite9()->AEGP_GetLayerID(layerH, &id) && static_cast<A_long>(id) == wantId) return layerH;
  }
  return nullptr;
}

const char kHex[] = "0123456789abcdef";

std::string toHex(const unsigned char* p, size_t n) {
  std::string out;
  out.resize(n * 2);
  for (size_t i = 0; i < n; i++) {
    out[i * 2] = kHex[p[i] >> 4];
    out[i * 2 + 1] = kHex[p[i] & 15];
  }
  return out;
}

int hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool fromHex(const std::string& hex, std::vector<unsigned char>& out) {
  if (hex.size() % 2) return false;
  out.resize(hex.size() / 2);
  for (size_t i = 0; i < out.size(); i++) {
    int hi = hexVal(hex[i * 2]);
    int lo = hexVal(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = static_cast<unsigned char>((hi << 4) | lo);
  }
  return true;
}

// Calls fn(streamH) for one effect parameter; disposes everything afterwards.
template <typename Fn>
std::string withParam(AEGP_LayerH layerH, A_long fx, A_long param, Fn fn) {
  AEGP_EffectRefH effectH = nullptr;
  if (g_suites->EffectSuite5()->AEGP_GetLayerEffectByIndex(g_pluginId, layerH, fx - 1, &effectH) || !effectH) return "err:no effect";
  std::string result;
  AEGP_StreamRefH streamH = nullptr;
  if (g_suites->StreamSuite6()->AEGP_GetNewEffectStreamByIndex(g_pluginId, effectH, param, &streamH) || !streamH) {
    result = "err:no param";
  } else {
    result = fn(streamH);
    g_suites->StreamSuite6()->AEGP_DisposeStream(streamH);
  }
  g_suites->EffectSuite5()->AEGP_DisposeEffect(effectH);
  return result;
}

std::string readArb(AEGP_StreamRefH streamH) {
  A_long kfs = 0;
  g_suites->KeyframeSuite5()->AEGP_GetStreamNumKFs(streamH, &kfs);
  if (kfs > 0) return "K";
  AEGP_StreamValue2 value;
  AEFX_CLR_STRUCT(value);
  A_Time t = {0, 1};
  if (g_suites->StreamSuite6()->AEGP_GetNewStreamValue(g_pluginId, streamH, AEGP_LTimeMode_CompTime, &t, TRUE, &value)) return "E";
  std::string out = "E";
  PF_Handle h = reinterpret_cast<PF_Handle>(value.val.arbH);
  if (h) {
    size_t size = static_cast<size_t>(g_suites->HandleSuite1()->host_get_handle_size(h));
    void* p = g_suites->HandleSuite1()->host_lock_handle(h);
    if (p) {
      char head[32];
      sprintf_s(head, "%zu:", size);
      out = std::string(head) + toHex(static_cast<unsigned char*>(p), size);
      g_suites->HandleSuite1()->host_unlock_handle(h);
    }
  }
  g_suites->StreamSuite6()->AEGP_DisposeStreamValue(&value);
  return out;
}

void cmdArbGet(const std::vector<std::string>& f) {
  std::string req = f.size() > 1 ? f[1] : "";
  if (f.size() < 4) {
    emit("ARB\t" + req + "\terr:args");
    return;
  }
  AEGP_CompH compH = findCompByItemId(atol(f[2].c_str()));
  AEGP_LayerH layerH = compH ? findLayerById(compH, atol(f[3].c_str())) : nullptr;
  if (!layerH) {
    emit("ARB\t" + req + "\terr:not found");
    return;
  }
  std::string body;
  A_long numFx = 0;
  g_suites->EffectSuite5()->AEGP_GetLayerNumEffects(layerH, &numFx);
  for (A_long fx = 1; fx <= numFx; fx++) {
    AEGP_EffectRefH effectH = nullptr;
    if (g_suites->EffectSuite5()->AEGP_GetLayerEffectByIndex(g_pluginId, layerH, fx - 1, &effectH) || !effectH) continue;
    A_long numParams = 0;
    g_suites->StreamSuite6()->AEGP_GetEffectNumParamStreams(effectH, &numParams);
    for (A_long param = 1; param < numParams; param++) {
      AEGP_StreamRefH streamH = nullptr;
      if (g_suites->StreamSuite6()->AEGP_GetNewEffectStreamByIndex(g_pluginId, effectH, param, &streamH) || !streamH) continue;
      AEGP_StreamType type = AEGP_StreamType_NO_DATA;
      g_suites->StreamSuite6()->AEGP_GetStreamType(streamH, &type);
      if (type == AEGP_StreamType_ARB) {
        char key[32];
        sprintf_s(key, "%ld:%ld:", static_cast<long>(fx), static_cast<long>(param));
        if (!body.empty()) body += ";";
        body += key + readArb(streamH);
      }
      g_suites->StreamSuite6()->AEGP_DisposeStream(streamH);
    }
    g_suites->EffectSuite5()->AEGP_DisposeEffect(effectH);
  }
  emit("ARB\t" + req + "\tok\t" + body);
}

void cmdArbSet(const std::vector<std::string>& f) {
  std::string req = f.size() > 1 ? f[1] : "";
  if (f.size() < 7) {
    emit("ARBOK\t" + req + "\terr:args");
    return;
  }
  std::vector<unsigned char> bytes;
  if (!fromHex(f[6], bytes) || bytes.empty()) {
    emit("ARBOK\t" + req + "\terr:bad data");
    return;
  }
  AEGP_CompH compH = findCompByItemId(atol(f[2].c_str()));
  AEGP_LayerH layerH = compH ? findLayerById(compH, atol(f[3].c_str())) : nullptr;
  if (!layerH) {
    emit("ARBOK\t" + req + "\terr:not found");
    return;
  }
  std::string result = withParam(layerH, atol(f[4].c_str()), atol(f[5].c_str()), [&](AEGP_StreamRefH streamH) -> std::string {
    AEGP_StreamType type = AEGP_StreamType_NO_DATA;
    g_suites->StreamSuite6()->AEGP_GetStreamType(streamH, &type);
    if (type != AEGP_StreamType_ARB) return std::string("err:not custom data");
    A_long kfs = 0;
    g_suites->KeyframeSuite5()->AEGP_GetStreamNumKFs(streamH, &kfs);
    if (kfs > 0) return std::string("err:keyframed");
    AEGP_StreamValue2 value;
    AEFX_CLR_STRUCT(value);
    A_Time t = {0, 1};
    if (g_suites->StreamSuite6()->AEGP_GetNewStreamValue(g_pluginId, streamH, AEGP_LTimeMode_CompTime, &t, TRUE, &value)) return std::string("err:read");
    PF_Handle h = reinterpret_cast<PF_Handle>(value.val.arbH);
    std::string r = "ok";
    if (!h) {
      r = "err:no data";
    } else if (g_suites->HandleSuite1()->host_get_handle_size(h) != bytes.size()) {
      // Different sizes mean a different layout (e.g. another plug-in
      // version): never write bytes the effect might misread.
      r = "err:size";
    } else {
      void* p = g_suites->HandleSuite1()->host_lock_handle(h);
      if (!p) {
        r = "err:lock";
      } else {
        memcpy(p, bytes.data(), bytes.size());
        g_suites->HandleSuite1()->host_unlock_handle(h);
        g_suites->UtilitySuite6()->AEGP_StartUndoGroup("Vynk: teammate edit");
        if (g_suites->StreamSuite6()->AEGP_SetStreamValue(g_pluginId, streamH, &value)) r = "err:set";
        g_suites->UtilitySuite6()->AEGP_EndUndoGroup();
      }
    }
    g_suites->StreamSuite6()->AEGP_DisposeStreamValue(&value);
    return r;
  });
  emit("ARBOK\t" + req + "\t" + result);
}

void runCommands() {
  std::vector<std::string> cmds;
  {
    std::lock_guard<std::mutex> lock(g_cmdMutex);
    cmds.swap(g_cmds);
  }
  for (const auto& line : cmds) {
    std::vector<std::string> f = splitTabs(line);
    try {
      if (f[0] == "ARBGET") cmdArbGet(f);
      else if (f[0] == "ARBSET") cmdArbSet(f);
    } catch (...) {
      emit(std::string(f[0] == "ARBSET" ? "ARBOK\t" : "ARB\t") + (f.size() > 1 ? f[1] : "") + "\terr:exception");
    }
  }
}

}  // namespace

void AeHost_enqueue(const std::string& line) {
  {
    std::lock_guard<std::mutex> lock(g_cmdMutex);
    g_cmds.push_back(line);
  }
  // The only suite call that is safe off the main thread.
  if (g_suites) {
    try {
      g_suites->UtilitySuite6()->AEGP_CauseIdleRoutinesToBeCalled();
    } catch (...) {
    }
  }
}

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

  runCommands();

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
