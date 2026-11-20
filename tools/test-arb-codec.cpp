#include "ArbData.h"
#include "NativeScript.h"
#include <iostream>
#include <stdexcept>

void check(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}

struct ScriptHandle {
  const char* text;
  int lockError = 0, locks = 0, unlocks = 0, frees = 0;
};
struct ScriptMemory {
  int AEGP_LockMemHandle(ScriptHandle* handle, void** text) {
    handle->locks++;
    *text = const_cast<char*>(handle->text);
    return handle->lockError;
  }
  int AEGP_UnlockMemHandle(ScriptHandle* handle) { handle->unlocks++; return 0; }
  int AEGP_FreeMemHandle(ScriptHandle* handle) { handle->frees++; return 0; }
};

void scriptResults() {
  ScriptMemory memory;
  std::string result, error;
  ScriptHandle good{"{\"r\":[\"\"]}"}, empty{""};
  check(NativeScript::readResult(&memory, &good, &empty, 0, result, error), "SDK success may allocate an empty error handle");
  check(result == good.text && error.empty(), "script result bytes preserved");
  check(good.locks == 1 && good.unlocks == 1 && good.frees == 1 && empty.locks == 1 && empty.unlocks == 1 && empty.frees == 1, "both SDK handles released once");
  ScriptHandle failed{"ReferenceError: vynkSync is undefined"};
  check(!NativeScript::readResult(&memory, &good, &failed, 0, result, error) && error == failed.text, "nonempty script errors reject success");
  ScriptHandle unreadable{"ignored", 1};
  check(!NativeScript::readResult(&memory, &unreadable, static_cast<ScriptHandle*>(nullptr), 0, result, error), "memory lock failure rejects script result");
  check(unreadable.frees == 1 && unreadable.unlocks == 0, "failed lock still frees handle without unlocking");
  ScriptHandle absent{nullptr};
  check(!NativeScript::readResult(&memory, &absent, static_cast<ScriptHandle*>(nullptr), 0, result, error), "null SDK text rejects success");
  check(absent.frees == 1 && absent.unlocks == 1, "successful null lock is released");
  check(!NativeScript::readResult(&memory, static_cast<ScriptHandle*>(nullptr), &failed, 5, result, error) && error == failed.text, "SDK failure keeps the returned error");
  check(!NativeScript::readResult(&memory, &good, static_cast<ScriptHandle*>(nullptr), 5, result, error) && error == "SDK error 5", "SDK error code rejects a populated result");
  check(!NativeScript::readResult(&memory, &empty, static_cast<ScriptHandle*>(nullptr), 0, result, error) && error == "empty script result", "empty results cannot be accepted as receipts");
}

void scriptFraming() {
  std::string line;
  const std::string compact = R"json({"r":[],"text":"keep  spaces \n \t \"quoted\" \\path"})json";
  const std::string pretty = R"json({
  "r": [

  ],
  "text": "keep  spaces \n \t \"quoted\" \\path"
})json";
  check(NativeScript::oneLineResult(compact, line) && line == compact, "compact receipt bytes preserved");
  check(NativeScript::oneLineResult("\t\r\n" + pretty + "\n", line) && line == compact, "pretty JSON receipts fit the one-line bridge");
  const std::string unicode = "{\"text\":\"\xc3\xa9\"}";
  check(NativeScript::oneLineResult(unicode, line) && line == unicode, "UTF-8 receipt bytes preserved");
  for (const std::string invalid : {std::string(), std::string("[]"), std::string("{\"text\":\"line\nbreak\"}"),
       std::string("{\"text\":\"tab\tvalue\"}"), std::string("{\"text\":\"unfinished\\")}) {
    check(!NativeScript::oneLineResult(invalid, line), "invalid line receipts rejected without rewriting string values");
  }
  std::string nul = "{\"a\":";
  nul.push_back('\0');
  nul += "}";
  check(!NativeScript::oneLineResult(nul, line), "embedded NUL cannot truncate a receipt");
}

int main() {
  try {
    scriptFraming();
    scriptResults();
    check(NativeScript::quote("\"\\\n\t\r") == "\"\\\"\\\\\\u000a\\u0009\\u000d\"", "native script quoting");
    check(NativeScript::quote(std::string("a\0b", 3)) == "\"a\\u0000b\"", "native script embedded NUL");
    check(NativeScript::quote("\xe2\x80\xa8\xe2\x80\xa9\xc3\xa9") == "\"\\u2028\\u2029\xc3\xa9\"", "ES3 line separators and UTF-8");
    ArbData::Value value;
    check(ArbData::parse("00aAFF", value) && !value.animated && value.keys[0].bytes.size() == 3, "static bytes");
    check(ArbData::parse("K|-1/2,3,3,0,,aabb|7/3,2,2,3,0~0.75~0~0.60,ccdd", value), "animated bytes and metadata");
    check(value.animated && value.keys.size() == 2 && value.keys[0].time == -1 && value.keys[0].scale == 2 &&
          value.keys[1].ease[0].inInfluence == 0.75 && value.keys[1].flags == 3, "animation metadata preserved");
    ArbData::Value copy;
    check(ArbData::parse("K|-2/4,3,3,0,,AABB|14/6,2,2,3,0~0.750000001~0~0.60,ccdd", copy) && ArbData::same(value, copy), "equivalent times and stable ease precision");
    copy.keys[0].bytes[0] = 1;
    check(!ArbData::same(value, copy), "readback catches changed arbitrary bytes");
    copy = value; copy.keys[1].flags = 0;
    check(!ArbData::same(value, copy), "readback catches changed interpolation flags");
    for (const char* invalid : {"", "0", "zz", "K|", "K|0/0,1,1,0,,aa", "K|0/1,0,1,0,,aa",
         "K|0/1,1,4,0,,aa", "K|0/1,1,1,4,,aa", "K|0/1,2,2,0,nan~0.75~0~0.75,aa",
         "K|0/1,2,2,0,0~1.01~0~0.75,aa", "K|0/1,1,1,0,,a", "K|0/1,1,1,0,,aa|0/2,1,1,0,,bb",
         "K|2/3,1,1,0,,aa|1/3,1,1,0,,bb", "K|2147483648/1,1,1,0,,aa", "K|0/4294967296,1,1,0,,aa"}) {
      check(!ArbData::parse(invalid, value), invalid);
    }
    check(!ArbData::parse(std::string(ArbData::MaxText + 2, 'a'), value), "payload bounded");
    std::string text = "K";
    for (size_t i = 0; i <= ArbData::MaxKeys; i++) text += "|" + std::to_string(i) + "/1,1,1,0,,aa";
    check(!ArbData::parse(text, value), "key count bounded");
    std::cout << "PASS: arbitrary-data payload validation and animation metadata\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL: " << error.what() << "\n";
    return 1;
  }
}
