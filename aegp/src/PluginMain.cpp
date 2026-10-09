#include "AEConfig.h"
#ifdef AE_OS_WIN
#include <windows.h>
#endif
#include "entry.h"
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include "AEGP_SuiteHandler.h"

#include "AeHost.h"
#include "Bridge.h"
#include "Overlay.h"

#include <cstdio>
#include <cstdlib>
#include <string>

namespace {

// The bridge binds an ephemeral loopback port (no fixed number) and advertises
// it in this file; the CEP panel reads the file to find us. This avoids
// fixed-port collisions and ghost listeners. Carries comp reads/changes AND
// cursor/peer traffic.
const char* kPortFileRel = "\\Vynk\\bridge.port";

std::string portFilePath() {
  const char* local = std::getenv("LOCALAPPDATA");
  if (!local) return std::string();
  return std::string(local) + kPortFileRel;
}

void writePortFile(unsigned short port) {
  std::string file = portFilePath();
  if (file.empty()) return;
  std::string dir = file.substr(0, file.find_last_of('\\'));
  CreateDirectoryA(dir.c_str(), nullptr);
  FILE* f = nullptr;
  if (fopen_s(&f, file.c_str(), "w") == 0 && f) {
    fprintf(f, "%u\n", static_cast<unsigned>(port));
    fclose(f);
  }
}

void deletePortFile() {
  std::string file = portFilePath();
  if (!file.empty()) DeleteFileA(file.c_str());
}

// Idle-hook sleep hint (ms). Keep this generous: AE may call the idle hook at
// most this often, so a small value wakes AE constantly. 250ms ~= 4 Hz.
constexpr A_long kIdleSleepMs = 250;

AEGP_PluginID S_my_id = 0;
SPBasicSuite* sP = nullptr;
Bridge g_bridge;

void hostSink(const char* line) { g_bridge.sendLine(line); }

A_Err DeathHook(AEGP_GlobalRefcon /*plugin_refconP*/, AEGP_DeathRefcon /*refconP*/) {
  Overlay_stop();
  g_bridge.stop();
  deletePortFile();
  AeHost_shutdown();
  return A_Err_NONE;
}

A_Err IdleHook(AEGP_GlobalRefcon /*plugin_refconP*/, AEGP_IdleRefcon /*refconP*/,
               A_long* max_sleepPL) {
  if (max_sleepPL) *max_sleepPL = kIdleSleepMs;
  // Inbound bridge traffic (PEERS/PING/HELLO) is handled on the overlay thread
  // so cursor updates stay responsive; the idle hook only does comp reads.
  AeHost_onIdle(static_cast<long long>(GetTickCount64()));
  return A_Err_NONE;
}

}  // namespace

extern "C" {

// Signature MUST match AEGP_PluginInitFuncPrototype in AE_GeneralPlug.h (5 args;
// older SDK samples show a stale 7-arg form with file_pathZ/res_pathZ).
DllExport A_Err EntryPointFunc(struct SPBasicSuite* pica_basicP,
                               A_long /*driver_major_versionL*/, A_long /*driver_minor_versionL*/,
                               AEGP_PluginID aegp_plugin_id,
                               AEGP_GlobalRefcon* plugin_refconP) {
  A_Err err = A_Err_NONE;
  A_Err err2 = A_Err_NONE;

  sP = pica_basicP;
  S_my_id = aegp_plugin_id;

  AEGP_SuiteHandler suites(pica_basicP);

  // Deliberately register ONLY idle + death hooks. A command hook for
  // AEGP_Command_ALL (as the samples show) runs on every AE command and can
  // interfere with the UI; the bridge does not need menu integration yet.
  ERR(suites.RegisterSuite5()->AEGP_RegisterDeathHook(S_my_id, DeathHook, nullptr));
  ERR(suites.RegisterSuite5()->AEGP_RegisterIdleHook(S_my_id, IdleHook, nullptr));

  if (plugin_refconP) {
    *plugin_refconP = reinterpret_cast<AEGP_GlobalRefcon>(static_cast<intptr_t>(aegp_plugin_id));
  }

  AeHost_init(pica_basicP, static_cast<unsigned int>(aegp_plugin_id), hostSink);
  if (g_bridge.start(0)) {
    writePortFile(g_bridge.port());
  }
  Overlay_start(&g_bridge);

  return err;
}

}  // extern "C"
