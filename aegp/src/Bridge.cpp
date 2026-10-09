#include "Bridge.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>

#include <cstring>

namespace {
constexpr int kRecvBuf = 4096;
constexpr int kSelectTimeoutMs = 50;
// Cap queued lines so a flood (or a period with no consumer) cannot grow memory
// without bound; oldest lines are dropped first.
constexpr size_t kMaxOutbound = 256;
constexpr size_t kMaxInbound = 512;

// Send the whole buffer, looping on partial writes. Returns false on error.
bool sendAll(SOCKET s, const char* data, int len) {
  int sent = 0;
  while (sent < len) {
    int n = ::send(s, data + sent, len - sent, 0);
    if (n <= 0) return false;
    sent += n;
  }
  return true;
}
}  // namespace

Bridge::Bridge() = default;

Bridge::~Bridge() { stop(); }

bool Bridge::start(unsigned short port) {
  if (running_.load()) return true;
  port_ = port;

  WSADATA wsa{};
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;

  SOCKET listenSock = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (listenSock == INVALID_SOCKET) {
    WSACleanup();
    return false;
  }
  // Deliberately NO SO_REUSEADDR: on Windows it lets two sockets bind the same
  // loopback port, and connections can then land on a dead one (observed as a
  // ghost listener after a hard-killed AE). Ephemeral binding (port 0) plus a
  // port file avoids fixed-port collisions entirely.

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port_);
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
  if (bind(listenSock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    closesocket(listenSock);
    WSACleanup();
    return false;
  }
  if (listen(listenSock, 1) != 0) {
    closesocket(listenSock);
    WSACleanup();
    return false;
  }
  // Learn the actual port (needed when 0 was requested).
  sockaddr_in bound{};
  int boundLen = sizeof(bound);
  if (getsockname(listenSock, reinterpret_cast<sockaddr*>(&bound), &boundLen) == 0) {
    port_ = ntohs(bound.sin_port);
  }

  listenSock_ = static_cast<unsigned long long>(listenSock);
  running_.store(true);
  thread_ = std::thread([this] { acceptLoop(); });
  return true;
}

void Bridge::stop() {
  if (!running_.exchange(false)) return;
  // Wake the accept/select loop and close sockets.
  SOCKET listenSock = static_cast<SOCKET>(listenSock_);
  SOCKET clientSock = static_cast<SOCKET>(clientSock_);
  if (clientSock != INVALID_SOCKET && clientSock_ != ~0ull) ::shutdown(clientSock, SD_BOTH);
  if (listenSock != INVALID_SOCKET && listenSock_ != ~0ull) ::closesocket(listenSock);
  listenSock_ = ~0ull;
  if (thread_.joinable()) thread_.join();
  WSACleanup();
}

void Bridge::sendLine(const std::string& line) {
  std::lock_guard<std::mutex> lock(outMutex_);
  if (outbound_.size() >= kMaxOutbound) outbound_.erase(outbound_.begin());
  outbound_.push_back(line + "\n");
}

size_t Bridge::drainInbound(std::vector<std::string>& out) {
  std::lock_guard<std::mutex> lock(inMutex_);
  size_t n = inbound_.size();
  for (auto& line : inbound_) out.push_back(std::move(line));
  inbound_.clear();
  return n;
}

void Bridge::acceptLoop() {
  while (running_.load()) {
    SOCKET listenSock = static_cast<SOCKET>(listenSock_);
    SOCKET client = ::accept(listenSock, nullptr, nullptr);
    if (client == INVALID_SOCKET) {
      if (!running_.load()) break;
      continue;
    }
    clientSock_ = static_cast<unsigned long long>(client);
    connected_.store(true);
    clientLoop(static_cast<unsigned long long>(client));
    connected_.store(false);
    clientSock_ = ~0ull;
    ::closesocket(client);
  }
}

void Bridge::clientLoop(unsigned long long clientSock) {
  SOCKET s = static_cast<SOCKET>(clientSock);
  std::string buffer;
  char recvBuf[kRecvBuf];

  while (running_.load()) {
    fd_set readSet;
    FD_ZERO(&readSet);
    FD_SET(s, &readSet);
    timeval tv{};
    tv.tv_sec = 0;
    tv.tv_usec = kSelectTimeoutMs * 1000;

    int ready = ::select(0, &readSet, nullptr, nullptr, &tv);
    if (ready < 0) break;

    if (ready > 0 && FD_ISSET(s, &readSet)) {
      int n = ::recv(s, recvBuf, kRecvBuf, 0);
      if (n <= 0) break;
      buffer.append(recvBuf, static_cast<size_t>(n));
      size_t pos;
      while ((pos = buffer.find('\n')) != std::string::npos) {
        std::string line = buffer.substr(0, pos);
        buffer.erase(0, pos + 1);
        if (!line.empty()) {
          std::lock_guard<std::mutex> lock(inMutex_);
          if (inbound_.size() >= kMaxInbound) inbound_.erase(inbound_.begin());
          inbound_.push_back(std::move(line));
        }
      }
    }

    flushOutbound(clientSock);
  }
}

void Bridge::flushOutbound(unsigned long long clientSock) {
  std::vector<std::string> pending;
  {
    std::lock_guard<std::mutex> lock(outMutex_);
    if (outbound_.empty()) return;
    pending.swap(outbound_);
  }
  SOCKET s = static_cast<SOCKET>(clientSock);
  for (auto& line : pending) {
    if (!sendAll(s, line.data(), static_cast<int>(line.size()))) break;
  }
}
