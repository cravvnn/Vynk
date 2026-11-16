#pragma once

#include <string>

namespace NativeScript {
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
