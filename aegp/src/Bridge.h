#pragma once
#include <string>
#include <vector>
#include <mutex>
#include <thread>
#include <atomic>

// Localhost TCP bridge. The CEP panel connects here and exchanges tab-separated
// line messages. A background thread owns the socket; received lines are queued
// and drained on the AE main thread (idle hook). No JSON in C++, matching the
// existing cursor helper's design.
class Bridge {
 public:
  Bridge();
  ~Bridge();

  // Pass port 0 to let the OS pick a free port (read it back via port()).
  bool start(unsigned short port);
  unsigned short port() const { return port_; }
  void stop();

  // Thread-safe: queue a line to be written to the panel.
  void sendLine(const std::string& line);

  // Main-thread: move queued inbound lines into `out`; returns how many.
  size_t drainInbound(std::vector<std::string>& out);

  bool connected() const { return connected_.load(); }

 private:
  void acceptLoop();
  void clientLoop(unsigned long long clientSock);
  void flushOutbound(unsigned long long clientSock);

  unsigned short port_ = 0;
  std::atomic<bool> running_{false};
  std::atomic<bool> connected_{false};
  unsigned long long listenSock_ = ~0ull;
  unsigned long long clientSock_ = ~0ull;
  std::thread thread_;

  std::mutex inMutex_;
  std::vector<std::string> inbound_;

  std::mutex outMutex_;
  std::vector<std::string> outbound_;
};
