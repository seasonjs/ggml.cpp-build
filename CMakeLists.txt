cmake_minimum_required(VERSION 3.21)
project("ggml-build" LANGUAGES C CXX)

include(FetchContent)

function(ggml_default_cache name type value doc)
    if (NOT DEFINED CACHE{${name}})
        set(${name} "${value}" CACHE ${type} "${doc}")
    endif()
endfunction()

set(GGML_UPSTREAM_TAG "v0.9.8" CACHE STRING "ggml tag to fetch when no local source tree is available")
set(
    GGML_SOURCE_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/build/_deps/ggml-src"
    CACHE PATH
    "Optional local ggml source tree. When present it is preferred over downloading ggml."
)

option(
    GGML_BUILD_ALL_PLATFORM_BACKENDS
    "Enable the full backend set that makes sense for the current platform and toolchain"
    ON
)

set(_ggml_cpu_all_variants_default OFF)
if (GGML_BUILD_ALL_PLATFORM_BACKENDS)
    if (WIN32)
        if (CMAKE_GENERATOR_PLATFORM MATCHES "^[Xx]64$" OR CMAKE_SYSTEM_PROCESSOR MATCHES "^(AMD64|amd64|x86_64)$")
            set(_ggml_cpu_all_variants_default ON)
        endif()
    elseif (APPLE)
        if (CMAKE_OSX_ARCHITECTURES MATCHES "(^|;)(arm64|x86_64)($|;)" OR CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64|x86_64)$")
            set(_ggml_cpu_all_variants_default ON)
        endif()
    elseif (CMAKE_SYSTEM_NAME STREQUAL "Linux")
        if (CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|AMD64|amd64|aarch64|arm64|ppc64le|powerpc64le|s390x|riscv64)$")
            set(_ggml_cpu_all_variants_default ON)
        endif()
    endif()
endif()

set(_ggml_vulkan_default OFF)
if (GGML_BUILD_ALL_PLATFORM_BACKENDS AND (WIN32 OR CMAKE_SYSTEM_NAME STREQUAL "Linux"))
    find_program(_GGML_GLSLC_EXECUTABLE NAMES glslc HINTS ENV VULKAN_SDK PATH_SUFFIXES Bin bin)
    if (_GGML_GLSLC_EXECUTABLE OR DEFINED ENV{VULKAN_SDK})
        set(_ggml_vulkan_default ON)
    endif()
endif()

set(_ggml_cuda_default OFF)
if (GGML_BUILD_ALL_PLATFORM_BACKENDS AND (WIN32 OR CMAKE_SYSTEM_NAME STREQUAL "Linux"))
    find_program(_GGML_NVCC_EXECUTABLE NAMES nvcc nvcc.exe HINTS ENV CUDA_PATH ENV CUDAToolkit_ROOT PATH_SUFFIXES bin)
    if (_GGML_NVCC_EXECUTABLE OR DEFINED CMAKE_CUDA_COMPILER OR DEFINED ENV{CUDA_PATH})
        set(_ggml_cuda_default ON)
    endif()
endif()

set(_ggml_hip_default OFF)
if (GGML_BUILD_ALL_PLATFORM_BACKENDS AND (WIN32 OR CMAKE_SYSTEM_NAME STREQUAL "Linux"))
    if (WIN32)
        find_program(_GGML_HIP_CLANGXX_EXECUTABLE NAMES clang++.exe clang++.bat HINTS ENV HIP_PATH ENV ROCM_PATH PATH_SUFFIXES bin)
        if (_GGML_HIP_CLANGXX_EXECUTABLE OR DEFINED ENV{HIP_PATH} OR DEFINED ENV{ROCM_PATH} OR EXISTS "C:/Program Files/AMD/ROCm")
            set(_ggml_hip_default ON)
        endif()
    else()
        find_program(_GGML_HIPCC_EXECUTABLE NAMES hipcc HINTS ENV ROCM_PATH PATH_SUFFIXES bin)
        if (_GGML_HIPCC_EXECUTABLE OR EXISTS "/opt/rocm" OR EXISTS "/usr/lib64/cmake/hip" OR EXISTS "/usr/lib/cmake/hip")
            set(_ggml_hip_default ON)
        endif()
    endif()
endif()

set(_ggml_metal_default OFF)
set(_ggml_accelerate_default OFF)
set(_ggml_blas_default OFF)
set(_ggml_blas_vendor_default "Generic")
if (GGML_BUILD_ALL_PLATFORM_BACKENDS AND APPLE)
    set(_ggml_metal_default ON)
    set(_ggml_accelerate_default ON)
    set(_ggml_blas_default ON)
    set(_ggml_blas_vendor_default "Apple")
endif()

option(GGML_ENABLE_CPU_ALL_VARIANTS "Build all supported CPU backend variants when using backend plugins" ${_ggml_cpu_all_variants_default})
option(GGML_ENABLE_VULKAN "Enable the Vulkan backend when the toolchain is available" ${_ggml_vulkan_default})
option(GGML_ENABLE_CUDA "Enable the CUDA backend when the toolkit is available" ${_ggml_cuda_default})
option(GGML_ENABLE_HIP "Enable the HIP backend when ROCm tooling is available" ${_ggml_hip_default})
option(GGML_ENABLE_METAL "Enable the Metal backend on Apple platforms" ${_ggml_metal_default})
option(GGML_ENABLE_ACCELERATE "Enable Accelerate on Apple platforms" ${_ggml_accelerate_default})
option(GGML_ENABLE_BLAS "Enable the BLAS backend" ${_ggml_blas_default})
set(GGML_ENABLE_BLAS_VENDOR "${_ggml_blas_vendor_default}" CACHE STRING "BLAS vendor to use when GGML_ENABLE_BLAS is ON")

ggml_default_cache(BUILD_SHARED_LIBS BOOL ON "Build ggml as shared libraries")
ggml_default_cache(GGML_BACKEND_DL BOOL ON "Build ggml backends as dynamically loaded plugins")
ggml_default_cache(GGML_NATIVE BOOL OFF "Disable host-only tuning so CI artifacts stay portable")
ggml_default_cache(GGML_CPU BOOL ON "Enable the ggml CPU backend")
ggml_default_cache(GGML_CPU_ALL_VARIANTS BOOL ${GGML_ENABLE_CPU_ALL_VARIANTS} "Build all supported CPU backend variants")
ggml_default_cache(GGML_VULKAN BOOL ${GGML_ENABLE_VULKAN} "Enable the Vulkan backend")
ggml_default_cache(GGML_CUDA BOOL ${GGML_ENABLE_CUDA} "Enable the CUDA backend")
ggml_default_cache(GGML_HIP BOOL ${GGML_ENABLE_HIP} "Enable the HIP backend")
ggml_default_cache(GGML_METAL BOOL ${GGML_ENABLE_METAL} "Enable the Metal backend")
ggml_default_cache(GGML_METAL_EMBED_LIBRARY BOOL ${GGML_ENABLE_METAL} "Embed the Metal shader library when building the Metal backend")
ggml_default_cache(GGML_ACCELERATE BOOL ${GGML_ENABLE_ACCELERATE} "Enable Accelerate")
ggml_default_cache(GGML_BLAS BOOL ${GGML_ENABLE_BLAS} "Enable the BLAS backend")
ggml_default_cache(GGML_BLAS_VENDOR STRING ${GGML_ENABLE_BLAS_VENDOR} "BLAS vendor")
ggml_default_cache(GGML_BUILD_TESTS BOOL OFF "Disable upstream ggml tests in packaging builds")
ggml_default_cache(GGML_BUILD_EXAMPLES BOOL OFF "Disable upstream ggml examples in packaging builds")
ggml_default_cache(GGML_CCACHE BOOL ON "Skip ccache probing in clean CI environments")

add_compile_definitions(GGML_MAX_NAME=128)

get_filename_component(_ggml_local_source_dir "${GGML_SOURCE_DIR}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

message(STATUS "ggml-build configuration:")
message(STATUS "  GGML_BUILD_ALL_PLATFORM_BACKENDS = ${GGML_BUILD_ALL_PLATFORM_BACKENDS}")
message(STATUS "  GGML_SOURCE_DIR                  = ${_ggml_local_source_dir}")
message(STATUS "  BUILD_SHARED_LIBS               = ${BUILD_SHARED_LIBS}")
message(STATUS "  GGML_BACKEND_DL                 = ${GGML_BACKEND_DL}")
message(STATUS "  GGML_CPU_ALL_VARIANTS           = ${GGML_CPU_ALL_VARIANTS}")
message(STATUS "  GGML_VULKAN                     = ${GGML_VULKAN}")
message(STATUS "  GGML_CUDA                       = ${GGML_CUDA}")
message(STATUS "  GGML_HIP                        = ${GGML_HIP}")
message(STATUS "  GGML_METAL                      = ${GGML_METAL}")
message(STATUS "  GGML_ACCELERATE                 = ${GGML_ACCELERATE}")
message(STATUS "  GGML_BLAS                       = ${GGML_BLAS}")
message(STATUS "  GGML_BLAS_VENDOR                = ${GGML_BLAS_VENDOR}")

if (EXISTS "${_ggml_local_source_dir}/CMakeLists.txt")
    message(STATUS "Using local ggml source tree: ${_ggml_local_source_dir}")
    add_subdirectory("${_ggml_local_source_dir}" "${CMAKE_BINARY_DIR}/ggml")
else()
    message(STATUS "Fetching ggml ${GGML_UPSTREAM_TAG} from GitHub")
    FetchContent_Declare(
        ggml
        GIT_REPOSITORY https://github.com/ggml-org/ggml.git
        GIT_TAG        ${GGML_UPSTREAM_TAG}
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(ggml)
endif()
