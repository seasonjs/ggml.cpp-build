cmake_minimum_required(VERSION 3.21)
project("ggml-build" LANGUAGES C CXX)

include(FetchContent)

function(ggml_default_cache name type value doc)
    if (NOT DEFINED CACHE{${name}})
        set(${name} "${value}" CACHE ${type} "${doc}")
    endif()
endfunction()

function(ggml_patch_generated_config ggml_binary_dir)
    set(_ggml_config_file "${ggml_binary_dir}/ggml-config.cmake")
    if (NOT EXISTS "${_ggml_config_file}")
        message(WARNING "Skipping ggml-config.cmake fixup because ${_ggml_config_file} does not exist.")
        return()
    endif()

    file(READ "${_ggml_config_file}" _ggml_config_contents)
    set(_ggml_patched_contents "${_ggml_config_contents}")

    string(REPLACE
        [=[set_target_properties(ggml::ggml
        PROPERTIES
            IMPORTED_LOCATION "${GGML_LIBRARY}")]=]
        [=[set_target_properties(ggml::ggml
        PROPERTIES
            IMPORTED_LOCATION "${GGML_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${GGML_INCLUDE_DIR}")]=]
        _ggml_patched_contents
        "${_ggml_patched_contents}")

    string(REPLACE
        [=[set_target_properties(ggml::ggml-base
        PROPERTIES
            IMPORTED_LOCATION "${GGML_BASE_LIBRARY}")]=]
        [=[set_target_properties(ggml::ggml-base
        PROPERTIES
            IMPORTED_LOCATION "${GGML_BASE_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${GGML_INCLUDE_DIR}")]=]
        _ggml_patched_contents
        "${_ggml_patched_contents}")

    if (NOT _ggml_patched_contents STREQUAL _ggml_config_contents)
        file(WRITE "${_ggml_config_file}" "${_ggml_patched_contents}")
        message(STATUS "Patched exported ggml CMake package: ${_ggml_config_file}")
    endif()
endfunction()

set(GGML_UPSTREAM_TAG "v0.9.8" CACHE STRING "ggml tag to fetch when no local source tree is available")
set(
    GGML_SOURCE_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/build/_deps/ggml-src"
    CACHE PATH
    "Optional local ggml source tree. When present it is preferred over downloading ggml."
)

ggml_default_cache(BUILD_SHARED_LIBS BOOL ON "Build ggml as shared libraries")
ggml_default_cache(GGML_BACKEND_DL BOOL ON "Build ggml backends as dynamically loaded plugins")
ggml_default_cache(GGML_NATIVE BOOL OFF "Disable host-only tuning so CI artifacts stay portable")
ggml_default_cache(GGML_CPU BOOL ON "Enable the ggml CPU backend")
set(_ggml_cpu_all_variants_doc "Build all supported CPU backend variants when the CPU backend is enabled")
ggml_default_cache(GGML_CPU_ALL_VARIANTS BOOL ${GGML_CPU} "${_ggml_cpu_all_variants_doc}")
if (NOT GGML_CPU AND GGML_CPU_ALL_VARIANTS)
    message(STATUS "Disabling GGML_CPU_ALL_VARIANTS because GGML_CPU=OFF")
    set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "${_ggml_cpu_all_variants_doc}" FORCE)
endif()
ggml_default_cache(GGML_VULKAN BOOL OFF "Enable the Vulkan backend")
ggml_default_cache(GGML_CUDA BOOL OFF "Enable the CUDA backend")
ggml_default_cache(GGML_HIP BOOL OFF "Enable the HIP backend")
ggml_default_cache(GGML_METAL BOOL OFF "Enable the Metal backend")
ggml_default_cache(GGML_METAL_EMBED_LIBRARY BOOL OFF "Embed the Metal shader library when building the Metal backend")
ggml_default_cache(GGML_ACCELERATE BOOL OFF "Enable Accelerate")
ggml_default_cache(GGML_BLAS BOOL OFF "Enable the BLAS backend")
ggml_default_cache(GGML_BLAS_VENDOR STRING "Generic" "BLAS vendor")
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
    set(_ggml_binary_dir "${CMAKE_BINARY_DIR}/ggml")
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
    FetchContent_GetProperties(ggml BINARY_DIR _ggml_binary_dir)
endif()

ggml_patch_generated_config("${_ggml_binary_dir}")
