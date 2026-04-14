# ggml.cpp-build

This repository builds `ggml` as a shared-library SDK that can be published as CI artifacts and consumed by third-party CMake projects.

## Build An SDK

Use a clean build directory, then install into a staging prefix. The staged tree is what should be archived and uploaded to your release page.

```bash
cmake -S . -B build ^
  -DBUILD_SHARED_LIBS=ON ^
  -DGGML_BACKEND_DL=ON ^
  -DGGML_CPU=ON ^
  -DGGML_CPU_ALL_VARIANTS=ON ^
  -DGGML_BUILD_TESTS=OFF ^
  -DGGML_BUILD_EXAMPLES=OFF

cmake --build build --config Release
cmake --install build- --config Release --prefix
```

Package the contents of `ggml` directly:

- `ggml-linux-x86_64.tar.gz`
- `ggml-macos-arm64.tar.gz`
- `ggml-windows-x86_64.zip`

Each archive should contain the installed SDK layout:

```text
ggml-<platform>/
  manifests.json
  include/
  lib/
  bin/
  lib/cmake/ggml/ggml-config.cmake
```

The Linux and Windows assemble jobs also publish a sibling `*.manifests.json` file next to the archive in CI and Releases. It describes the platform, archive format, included backend overlays, and the exact file list so third-party tooling can identify the package before merging it into a larger SDK.

## Consume The SDK

The helper module [cmake/fetch_prebuilt_ggml.cmake](./cmake/fetch_prebuilt_ggml.cmake) lets a third-party project either:

- use an already unpacked SDK directory
- or download the correct archive for the current platform from your release page

Minimal consumer example:

```cmake
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/cmake")
include(fetch_prebuilt_ggml)

set(GGML_ROOT_DIR "" CACHE PATH "Path to an unpacked ggml SDK")
set(GGML_RELEASE_BASE_URL "https://github.com/seasonjs/ggml.cpp-build/releases/download" CACHE STRING "")
set(GGML_RELEASE_TAG "v0.9.8" CACHE STRING "")

if (GGML_ROOT_DIR)
    ggml_import_prebuilt(
        ROOT_DIR "${GGML_ROOT_DIR}"
        OUT_ROOT_DIR GGML_PACKAGE_ROOT
    )
else()
    ggml_import_prebuilt(
        RELEASE_BASE_URL "${GGML_RELEASE_BASE_URL}"
        RELEASE_TAG "${GGML_RELEASE_TAG}"
        OUT_ROOT_DIR GGML_PACKAGE_ROOT
    )
endif()

add_executable(main_app main.cpp)
target_link_libraries(main_app PRIVATE ggml::ggml)

ggml_copy_runtime_binaries(main_app
    ROOT_DIR "${GGML_PACKAGE_ROOT}"
)
```

The imported targets now propagate the installed `include/` directory, so linking `ggml::ggml` is enough to make `#include <ggml.h>` work.

`ggml_copy_runtime_binaries(...)` matters because with `BUILD_SHARED_LIBS=ON` and `GGML_BACKEND_DL=ON`, the executable needs the runtime files from `bin/` beside it so `ggml_backend_load_all()` can load the backend plugins.

The local example project at [example/CMakeLists.txt](./example/CMakeLists.txt) demonstrates the same flow.
