#pragma once

#include <cmath>
#include <charconv>
#include <string>
#include <vector>
#include <utility>

namespace ArbData {
constexpr size_t MaxText = 512 * 1024;
constexpr size_t MaxKeys = 600;

struct Ease { double inSpeed, inInfluence, outSpeed, outInfluence; };
struct Key {
  long time = 0;
  unsigned long scale = 1;
  long in = 1, out = 1, flags = 0;
  std::vector<Ease> ease;
  std::vector<unsigned char> bytes;
};
struct Value { bool animated = false; std::vector<Key> keys; };

inline std::vector<std::string> split(const std::string& text, char delimiter) {
  std::vector<std::string> out;
  size_t start = 0;
  for (;;) {
    size_t end = text.find(delimiter, start);
    out.push_back(text.substr(start, end == std::string::npos ? end : end - start));
    if (end == std::string::npos) return out;
    start = end + 1;
  }
}

inline bool number(const std::string& text, double& out) {
  auto parsed = std::from_chars(text.data(), text.data() + text.size(), out);
  return parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size() && std::isfinite(out);
}

inline bool integer(const std::string& text, long long low, long long high, long long& out) {
  double value = 0;
  if (!number(text, value) || value < low || value > high || std::floor(value) != value) return false;
  out = static_cast<long long>(value);
  return true;
}

inline int nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

inline bool hex(const std::string& text, std::vector<unsigned char>& bytes) {
  if (text.empty() || text.size() % 2 || text.size() > MaxText) return false;
  bytes.resize(text.size() / 2);
  for (size_t i = 0; i < bytes.size(); i++) {
    int hi = nibble(text[2 * i]), lo = nibble(text[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    bytes[i] = static_cast<unsigned char>((hi << 4) | lo);
  }
  return true;
}

inline bool parse(const std::string& text, Value& value) {
  value = Value{};
  if (text.size() > MaxText) return false;
  if (text.compare(0, 2, "K|") != 0) {
    value.keys.resize(1);
    return hex(text, value.keys[0].bytes);
  }
  value.animated = true;
  auto parts = split(text, '|');
  if (parts.size() < 2 || parts.size() - 1 > MaxKeys) return false;
  for (size_t i = 1; i < parts.size(); i++) {
    auto fields = split(parts[i], ',');
    if (fields.size() != 6) return false;
    auto time = split(fields[0], '/');
    long long n = 0, d = 0, in = 0, out = 0, flags = 0;
    if (time.size() != 2 ||
        !integer(time[0], -2147483648LL, 2147483647LL, n) ||
        !integer(time[1], 1, 4294967295LL, d) ||
        !integer(fields[1], 1, 3, in) || !integer(fields[2], 1, 3, out) ||
        !integer(fields[3], 0, 3, flags)) return false;
    Key key;
    key.time = static_cast<long>(n);
    key.scale = static_cast<unsigned long>(d);
    key.in = static_cast<long>(in); key.out = static_cast<long>(out); key.flags = static_cast<long>(flags);
    if (!value.keys.empty()) {
      const auto& prev = value.keys.back();
      if (static_cast<long long>(prev.time) * d >= n * static_cast<long long>(prev.scale)) return false;
    }
    if (!fields[4].empty()) {
      auto dims = split(fields[4], '/');
      if (dims.size() > 4) return false;
      for (const auto& dim : dims) {
        auto numbers = split(dim, '~');
        Ease ease{};
        if (numbers.size() != 4 || !number(numbers[0], ease.inSpeed) || !number(numbers[1], ease.inInfluence) ||
            !number(numbers[2], ease.outSpeed) || !number(numbers[3], ease.outInfluence) ||
            ease.inInfluence < 0 || ease.inInfluence > 1 || ease.outInfluence < 0 || ease.outInfluence > 1) return false;
        key.ease.push_back(ease);
      }
    }
    if (!hex(fields[5], key.bytes)) return false;
    value.keys.push_back(std::move(key));
  }
  return true;
}

inline bool numberNear(double a, double b) { return std::abs(a - b) <= 1e-7 * (1 + std::abs(a) + std::abs(b)); }

inline bool same(const Value& a, const Value& b) {
  if (a.animated != b.animated || a.keys.size() != b.keys.size()) return false;
  for (size_t i = 0; i < a.keys.size(); i++) {
    const auto& x = a.keys[i]; const auto& y = b.keys[i];
    if (x.bytes != y.bytes) return false;
    if (!a.animated) continue;
    if (static_cast<long long>(x.time) * y.scale != static_cast<long long>(y.time) * x.scale ||
        x.in != y.in || x.out != y.out || x.flags != y.flags || x.ease.size() != y.ease.size()) return false;
    for (size_t d = 0; d < x.ease.size(); d++) {
      if (!numberNear(x.ease[d].inSpeed, y.ease[d].inSpeed) || !numberNear(x.ease[d].inInfluence, y.ease[d].inInfluence) ||
          !numberNear(x.ease[d].outSpeed, y.ease[d].outSpeed) || !numberNear(x.ease[d].outInfluence, y.ease[d].outInfluence)) return false;
    }
  }
  return true;
}
}
