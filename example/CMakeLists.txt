cmake_minimum_required(VERSION 3.21)
project("example" LANGUAGES C CXX)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/../cmake")
include(fetch_prebuilt_ggml)

set(GGML_ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/vendor/ggml" CACHE PATH "Path to an unpacked ggml SDK")
set(GGML_RELEASE_BASE_URL "https://github.com/seasonjs/ggml.cpp-build/releases/download" CACHE STRING "Base release URL, for example https://github.com/seasonjs/ggml.cpp-build/releases/download")
set(GGML_RELEASE_TAG "v0.9.8" CACHE STRING "Release tag containing the prebuilt ggml SDK archives")

if (EXISTS "${GGML_ROOT_DIR}")
    ggml_import_prebuilt(
        ROOT_DIR "${GGML_ROOT_DIR}"
        OUT_ROOT_DIR GGML_PACKAGE_ROOT
    )
elseif (GGML_RELEASE_BASE_URL)
    ggml_import_prebuilt(
        RELEASE_BASE_URL "${GGML_RELEASE_BASE_URL}"
        RELEASE_TAG "${GGML_RELEASE_TAG}"
        OUT_ROOT_DIR GGML_PACKAGE_ROOT
    )
else()
    message(FATAL_ERROR
        "Set GGML_ROOT_DIR to an unpacked ggml SDK or provide GGML_RELEASE_BASE_URL so CMake can download one.")
endif()

add_executable(main_app main.cpp)

target_include_directories(main_app PRIVATE "${GGML_INCLUDE_DIR}")
target_link_libraries(main_app PRIVATE ggml::ggml)

ggml_copy_runtime_binaries(main_app
    ROOT_DIR "${GGML_PACKAGE_ROOT}"
)
