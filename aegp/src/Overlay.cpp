#include "Overlay.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "Bridge.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

const wchar_t* kOverlayClass = L"VynkOverlay";

struct Peer {
  std::string name;
  COLORREF color;
  double x;
  double y;
  bool hasCursor;
};

HWND g_overlay = nullptr;
HWND g_aeWindow = nullptr;
HFONT g_font = nullptr;
std::mutex g_peerMutex;
std::vector<Peer> g_peers;
bool g_overlayVisible = false;

Bridge* g_bridge = nullptr;
std::thread g_thread;
std::atomic<bool> g_running(false);
double g_lastX = -1.0;
double g_lastY = -1.0;
bool g_aeFocused = false;
bool g_aeWindowFound = false;
int g_tickCount = 0;

std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> parts;
  std::string cur;
  for (char c : s) {
    if (c == sep) {
      parts.push_back(cur);
      cur.clear();
    } else {
      cur.push_back(c);
    }
  }
  parts.push_back(cur);
  return parts;
}

COLORREF parseColor(const std::string& hex) {
  if (hex.size() < 7 || hex[0] != '#') return RGB(255, 255, 255);
  unsigned long v = strtoul(hex.c_str() + 1, nullptr, 16);
  return RGB((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
}

// Bounding box of a peer's arrow + name label (generous on the right so long
// names are fully covered). Used to invalidate only the cursors that moved.
RECT peerRect(const Peer& p, int w, int h) {
  int px = (int)(p.x * (double)w);
  int py = (int)(p.y * (double)h);
  RECT r;
  r.left = px - 2;
  r.top = py - 2;
  r.right = px + 260;
  r.bottom = py + 28;
  return r;
}

void setPeersFromLine(const std::string& payload) {
  std::vector<Peer> next;
  if (!payload.empty()) {
    for (const auto& row : split(payload, ';')) {
      std::vector<std::string> f = split(row, '\t');
      if (f.size() < 6) continue;
      Peer p;
      p.name = f[1];
      p.color = parseColor(f[2]);
      p.x = atof(f[3].c_str());
      p.y = atof(f[4].c_str());
      p.hasCursor = f[5] == "1";
      next.push_back(p);
      if (next.size() >= 16) break;  // room cap; ignore extras
    }
  }
  {
    std::lock_guard<std::mutex> lock(g_peerMutex);
    // Only repaint if something actually changed (the panel sends PEERS on
    // several events, often with identical positions).
    bool changed = next.size() != g_peers.size();
    if (!changed) {
      for (size_t i = 0; i < next.size(); i++) {
        const Peer& a = next[i];
        const Peer& b = g_peers[i];
        if (a.x != b.x || a.y != b.y || a.hasCursor != b.hasCursor || a.color != b.color || a.name != b.name) {
          changed = true;
          break;
        }
      }
    }
    if (changed && g_overlay) {
      // Invalidate only the old and new cursor rectangles (cheap incremental
      // repaint) rather than the whole window.
      RECT rc{};
      GetClientRect(g_overlay, &rc);
      for (const Peer& p : g_peers) {
        RECT r = peerRect(p, rc.right, rc.bottom);
        InvalidateRect(g_overlay, &r, FALSE);
      }
      for (const Peer& p : next) {
        RECT r = peerRect(p, rc.right, rc.bottom);
        InvalidateRect(g_overlay, &r, FALSE);
      }
    }
    g_peers.swap(next);
  }
}

void handleLine(const std::string& line) {
  if (line.compare(0, 6, "PEERS\t") == 0) {
    setPeersFromLine(line.substr(6));
    return;
  }
  if (line.compare(0, 6, "HELLO\t") == 0) {
    if (g_bridge) g_bridge->sendLine("HELLO\tvynk\t1");
    return;
  }
  if (line.compare(0, 4, "PING") == 0) {
    if (g_bridge) g_bridge->sendLine("PONG");
    return;
  }
}

void drainBridge() {
  if (!g_bridge) return;
  std::vector<std::string> lines;
  if (g_bridge->drainInbound(lines) == 0) return;
  for (const auto& line : lines) handleLine(line);
}

bool aeHasFocus() {
  if (!g_aeWindow) return false;
  HWND fg = GetForegroundWindow();
  if (!fg) return false;
  DWORD fgPid = 0;
  DWORD aePid = 0;
  GetWindowThreadProcessId(fg, &fgPid);
  GetWindowThreadProcessId(g_aeWindow, &aePid);
  return fgPid != 0 && fgPid == aePid;
}

struct WindowSearch {
  HWND best;
  long long bestScore;
};

BOOL CALLBACK enumWindowsProc(HWND hwnd, LPARAM lp) {
  if (!IsWindowVisible(hwnd)) return TRUE;
  if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
  wchar_t cls[256] = {0};
  GetClassNameW(hwnd, cls, 255);
  wchar_t title[512] = {0};
  GetWindowTextW(hwnd, title, 511);
  bool classHit = wcsstr(cls, L"AE_CApplication") != nullptr;
  bool titleHit = wcsstr(title, L"Adobe After Effects") != nullptr;
  if (!classHit && !titleHit) return TRUE;
  RECT r{};
  if (!GetWindowRect(hwnd, &r)) return TRUE;
  long long area = (long long)(r.right - r.left) * (long long)(r.bottom - r.top);
  if (area <= 0) return TRUE;
  long long score = area + (classHit ? (1LL << 44) : 0);
  WindowSearch* ws = (WindowSearch*)lp;
  if (score > ws->bestScore) {
    ws->bestScore = score;
    ws->best = hwnd;
  }
  return TRUE;
}

HWND findAeWindow() {
  HWND fg = GetForegroundWindow();
  // Prefer the foreground window if it is AE.
  if (fg) {
    wchar_t cls[256] = {0};
    GetClassNameW(fg, cls, 255);
    wchar_t title[512] = {0};
    GetWindowTextW(fg, title, 511);
    if (wcsstr(cls, L"AE_CApplication") || wcsstr(title, L"Adobe After Effects")) return fg;
  }
  WindowSearch ws{nullptr, 0};
  EnumWindows(enumWindowsProc, (LPARAM)&ws);
  return ws.best;
}

std::wstring toWide(const std::string& s) {
  if (s.empty()) return std::wstring();
  int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  if (len <= 1) return std::wstring();
  std::wstring out((size_t)(len - 1), L' ');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &out[0], len);
  return out;
}

void drawPeer(HDC dc, const Peer& p, int w, int h) {
  int px = (int)(p.x * (double)w);
  int py = (int)(p.y * (double)h);
  POINT arrow[7] = {
      {px, py}, {px, py + 18}, {px + 4, py + 13}, {px + 8, py + 20},
      {px + 11, py + 18}, {px + 7, py + 12}, {px + 12, py + 12}};
  HBRUSH fill = CreateSolidBrush(p.color);
  HPEN pen = CreatePen(PS_SOLID, 1, RGB(0, 0, 0));
  HGDIOBJ oldBrush = SelectObject(dc, fill);
  HGDIOBJ oldPen = SelectObject(dc, pen);
  Polygon(dc, arrow, 7);
  SelectObject(dc, oldBrush);
  SelectObject(dc, oldPen);
  DeleteObject(fill);
  DeleteObject(pen);

  std::wstring name = toWide(p.name);
  if (name.empty()) return;
  HGDIOBJ oldFont = g_font ? SelectObject(dc, g_font) : nullptr;
  SIZE sz{};
  GetTextExtentPoint32W(dc, name.c_str(), (int)name.size(), &sz);
  int pad = 4;
  int lx = px + 14;
  int ly = py + 12;
  RECT bg{lx, ly, lx + sz.cx + pad * 2, ly + sz.cy + pad};
  HBRUSH bgBrush = CreateSolidBrush(p.color);
  FillRect(dc, &bg, bgBrush);
  DeleteObject(bgBrush);
  FrameRect(dc, &bg, (HBRUSH)GetStockObject(BLACK_BRUSH));
  int oldMode = SetBkMode(dc, TRANSPARENT);
  COLORREF oldColor = SetTextColor(dc, RGB(12, 12, 12));
  TextOutW(dc, lx + pad, ly + pad / 2, name.c_str(), (int)name.size());
  SetTextColor(dc, oldColor);
  SetBkMode(dc, oldMode);
  if (oldFont) SelectObject(dc, oldFont);
}

void positionOverlayToRect(const RECT& want) {
  RECT cur{};
  GetWindowRect(g_overlay, &cur);
  if (want.left != cur.left || want.top != cur.top || (want.right - want.left) != (cur.right - cur.left) ||
      (want.bottom - want.top) != (cur.bottom - cur.top)) {
    SetWindowPos(g_overlay, HWND_TOPMOST, want.left, want.top, want.right - want.left,
                 want.bottom - want.top, SWP_NOACTIVATE);
    InvalidateRect(g_overlay, nullptr, TRUE); // full repaint after a move/resize
  }
}

void captureAndSendCursor(const RECT& want) {
  POINT pt{};
  if (!GetCursorPos(&pt)) return;
  if (pt.x < want.left || pt.x >= want.right || pt.y < want.top || pt.y >= want.bottom) return;
  double nx = (double)(pt.x - want.left) / (double)(want.right - want.left);
  double ny = (double)(pt.y - want.top) / (double)(want.bottom - want.top);
  if (nx == g_lastX && ny == g_lastY) return;
  g_lastX = nx;
  g_lastY = ny;
  char buf[96];
  sprintf_s(buf, "CURSOR\t%.5f\t%.5f", nx, ny);
  if (g_bridge) g_bridge->sendLine(buf);
}

LRESULT CALLBACK overlayProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC dc = BeginPaint(hwnd, &ps);
      RECT rc;
      GetClientRect(hwnd, &rc);
      // Fill only the dirty region with the color key; BeginPaint clips the DC
      // to it, so drawing peers below stays clipped too.
      HRGN dirty = CreateRectRgn(0, 0, 0, 0);
      if (dirty && GetUpdateRgn(hwnd, dirty, FALSE) != ERROR) {
        HBRUSH key = CreateSolidBrush(RGB(255, 0, 255));
        FillRgn(dc, dirty, key);
        DeleteObject(key);
      }
      if (dirty) DeleteObject(dirty);
      {
        std::lock_guard<std::mutex> lock(g_peerMutex);
        for (const Peer& p : g_peers) {
          if (!p.hasCursor) continue;
          drawPeer(dc, p, rc.right, rc.bottom);
        }
      }
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_TIMER: {
      g_tickCount++;
      drainBridge();

      if (!g_aeWindow || !IsWindow(g_aeWindow) || !IsWindowVisible(g_aeWindow)) {
        g_aeWindow = findAeWindow();
        if (!g_aeWindow) {
          if (g_overlayVisible) {
            ShowWindow(g_overlay, SW_HIDE);
            g_overlayVisible = false;
          }
          return 0;
        }
      }
      RECT want{};
      if (!GetWindowRect(g_aeWindow, &want)) return 0;
      positionOverlayToRect(want);

      bool focused = aeHasFocus();
      if (focused != g_aeFocused) {
        g_aeFocused = focused;
        if (g_bridge) g_bridge->sendLine(focused ? "FOCUS\t1" : "FOCUS\t0");
      }
      if (!focused) {
        if (g_overlayVisible) {
          ShowWindow(g_overlay, SW_HIDE);
          g_overlayVisible = false;
        }
        return 0;
      }
      if (!g_overlayVisible) {
        ShowWindow(g_overlay, SW_SHOWNOACTIVATE);
        g_overlayVisible = true;
      }
      captureAndSendCursor(want);
      return 0;
    }
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProc(hwnd, msg, wp, lp);
}

void overlayThreadMain() {
  HINSTANCE hInst = GetModuleHandleW(nullptr);
  g_font = CreateFontW(-12, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                       OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH,
                       L"Segoe UI");

  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = overlayProc;
  wc.hInstance = hInst;
  wc.lpszClassName = kOverlayClass;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassExW(&wc);

  g_overlay = CreateWindowExW(
      WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
      kOverlayClass, L"Vynk overlay", WS_POPUP, 0, 0, 100, 100, nullptr, nullptr, hInst,
      nullptr);
  if (!g_overlay) return;
  SetLayeredWindowAttributes(g_overlay, RGB(255, 0, 255), 255, LWA_COLORKEY);
  // ~33 Hz is smooth for cursor tracking while keeping the overlay thread light.
  SetTimer(g_overlay, 1, 33, nullptr);

  MSG msg;
  while (g_running.load() && GetMessage(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }
  KillTimer(g_overlay, 1);
  if (g_overlay) DestroyWindow(g_overlay);
  g_overlay = nullptr;
}

}  // namespace

void Overlay_start(Bridge* bridge) {
  if (g_running.load()) return;
  g_bridge = bridge;
  g_running.store(true);
  g_thread = std::thread(overlayThreadMain);
}

void Overlay_stop() {
  if (!g_running.exchange(false)) return;
  if (g_overlay) PostMessage(g_overlay, WM_CLOSE, 0, 0);
  if (g_thread.joinable()) g_thread.join();
}
