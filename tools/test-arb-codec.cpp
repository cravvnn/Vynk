#include "ArbData.h"
#include <iostream>
#include <stdexcept>

void check(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}

int main() {
  try {
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
