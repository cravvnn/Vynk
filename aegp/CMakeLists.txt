cmake_minimum_required(VERSION 3.20)
project(vynk_aegp LANGUAGES CXX RC)

# Native After Effects AEGP companion. Requires the After Effects C++ SDK under
# third_party/AfterEffectsSDK (see README.md). Point AE_SDK_PATH at the folder
# that contains "Examples".

if(NOT DEFINED AE_SDK_PATH)
  message(FATAL_ERROR "Set -DAE_SDK_PATH=<repo>/third_party/AfterEffectsSDK")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(AE_EXAMPLES  "${AE_SDK_PATH}/Examples")
set(AE_HEADERS   "${AE_EXAMPLES}/Headers")
set(AE_UTIL      "${AE_EXAMPLES}/Util")
set(AE_RESOURCES "${AE_EXAMPLES}/Resources")

if(NOT EXISTS "${AE_HEADERS}/AE_GeneralPlug.h")
  message(FATAL_ERROR "AE SDK headers not found under ${AE_HEADERS}")
endif()
if(NOT EXISTS "${AE_RESOURCES}/PiPLtool.exe")
  message(FATAL_ERROR "PiPLtool.exe not found under ${AE_RESOURCES}")
endif()

# ---- PiPL resource generation -------------------------------------------------
# 1) preprocess the .r with the C preprocessor (/P) -> .i
# 2) run the SDK PiPLtool to turn the .i into an RC fragment
set(PIPL_R    "${CMAKE_CURRENT_SOURCE_DIR}/res/vynk_PiPL.r")
set(PIPL_I    "${CMAKE_CURRENT_BINARY_DIR}/vynk_PiPL.i")
set(PIPL_TEMP "${CMAKE_CURRENT_BINARY_DIR}/vynk_PiPL_temp.rc")

# Use /EP (preprocess to stdout, no #line directives - PiPLtool rejects those).
# The stdout redirect needs a shell, so write a tiny .cmd and invoke it.
set(PIPL_CMD "${CMAKE_CURRENT_BINARY_DIR}/preprocess_pipl.cmd")
file(WRITE "${PIPL_CMD}"
  "@echo off\r\n"
  "\"${CMAKE_CXX_COMPILER}\" /nologo /I \"${AE_HEADERS}\" /EP \"${PIPL_R}\" > \"${PIPL_I}\"\r\n")

add_custom_command(
  OUTPUT "${PIPL_I}"
  COMMAND cmd.exe /C "${PIPL_CMD}"
  DEPENDS "${PIPL_R}" "${PIPL_CMD}"
  COMMENT "Preprocessing PiPL")

add_custom_command(
  OUTPUT "${PIPL_TEMP}"
  COMMAND "${AE_RESOURCES}/PiPLtool.exe" "${PIPL_I}" "${PIPL_TEMP}"
  DEPENDS "${PIPL_I}"
  COMMENT "Generating PiPL resource")

add_custom_target(pipL DEPENDS "${PIPL_TEMP}")

# ---- Plugin -------------------------------------------------------------------
add_library(vynk MODULE
  src/PluginMain.cpp
  src/Bridge.cpp
  src/AeHost.cpp
  src/Overlay.cpp
  "${AE_UTIL}/AEGP_SuiteHandler.cpp"
  "${AE_UTIL}/MissingSuiteError.cpp"
  res/vynk.rc
)

add_dependencies(vynk pipL)
set_source_files_properties(res/vynk.rc PROPERTIES OBJECT_DEPENDS "${PIPL_TEMP}")

target_include_directories(vynk PRIVATE
  "${AE_HEADERS}"
  "${AE_HEADERS}/SP"
  "${AE_HEADERS}/adobesdk"
  "${AE_RESOURCES}"
  "${AE_UTIL}"
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${CMAKE_CURRENT_BINARY_DIR}"   # so the .rc finds the generated PiPL fragment
)

target_compile_definitions(vynk PRIVATE
  MSWindows
  WIN32
  _WINDOWS
  NOMINMAX
  _CRT_SECURE_NO_WARNINGS
)

# RC needs the generated fragment on its include path too.
set(CMAKE_RC_FLAGS "${CMAKE_RC_FLAGS} /I\"${CMAKE_CURRENT_BINARY_DIR}\"")

target_link_libraries(vynk PRIVATE ws2_32)

set_target_properties(vynk PROPERTIES
  OUTPUT_NAME "vynk"
  SUFFIX ".aex"
  PREFIX ""
)
