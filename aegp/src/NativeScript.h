#pragma once

#include <string>

namespace NativeScript {
inline bool oneLineResult(const std::string& text, std::string& line) {
  line.clear();
  bool quoted = false, escaped = false;
  for (char c : text) {
    if (!quoted && (c == ' ' || c == '\t' || c == '\r' || c == '\n')) continue;
    if (static_cast<unsigned char>(c) < 32) { line.clear(); return false; }
    line += c;
    if (escaped) escaped = false;
    else if (quoted && c == '\\') escaped = true;
    else if (c == '"') quoted = !quoted;
  }
  if (quoted || escaped || line.empty() || line[0] != '{') { line.clear(); return false; }
  return true;
}

template <typename Memory, typename Handle>
inline bool readResult(Memory* memory, Handle resultH, Handle errorH, int sdkError,
                       std::string& result, std::string& error) {
  result.clear();
  error.clear();
  bool ok = !sdkError && resultH;
  auto readText = [&](Handle handle, std::string& out) {
    if (!handle) return;
    char* text = nullptr;
    if (!memory->AEGP_LockMemHandle(handle, reinterpret_cast<void**>(&text))) {
      if (text) out = text;
      else ok = false;
      memory->AEGP_UnlockMemHandle(handle);
    } else ok = false;
    memory->AEGP_FreeMemHandle(handle);
  };
  readText(resultH, result);
  readText(errorH, error);
  if (error.empty() && sdkError) error = "SDK error " + std::to_string(sdkError);
  if (error.empty() && !ok) error = "unreadable script result";
  if (error.empty() && result.empty()) error = "empty script result";
  return ok && error.empty();
}

inline std::string quote(const std::string& text) {
  const char hex[] = "0123456789abcdef";
  std::string out = "\"";
  for (size_t i = 0; i < text.size(); i++) {
    unsigned char c = static_cast<unsigned char>(text[i]);
    if (c == '\\' || c == '"') {
      out += '\\'; out += static_cast<char>(c);
    } else if (c < 32) {
      out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15];
    } else if (c == 0xe2 && i + 2 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0x80 &&
               (static_cast<unsigned char>(text[i + 2]) == 0xa8 || static_cast<unsigned char>(text[i + 2]) == 0xa9)) {
      out += static_cast<unsigned char>(text[i + 2]) == 0xa8 ? "\\u2028" : "\\u2029";
      i += 2;
    } else {
      out += static_cast<char>(c);
    }
  }
  return out + '"';
}
}
