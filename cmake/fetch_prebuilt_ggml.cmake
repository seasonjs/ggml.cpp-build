include_guard(GLOBAL)

include(CMakeParseArguments)

function(_ggml_prebuilt_platform out_platform out_archive_ext)
    string(TOLOWER "${CMAKE_SYSTEM_NAME}" _ggml_system_name)
    string(TOLOWER "${CMAKE_SYSTEM_PROCESSOR}" _ggml_system_processor)

    if (_ggml_system_name STREQUAL "linux" AND _ggml_system_processor MATCHES "^(x86_64|amd64)$")
        set(_ggml_platform "linux-x86_64")
        set(_ggml_archive_ext ".tar.gz")
    elseif (_ggml_system_name STREQUAL "darwin" AND _ggml_system_processor MATCHES "^(arm64|aarch64)$")
        set(_ggml_platform "macos-arm64")
        set(_ggml_archive_ext ".tar.gz")
    elseif (WIN32 AND _ggml_system_processor MATCHES "^(x86_64|amd64)$")
        set(_ggml_platform "windows-x86_64")
        set(_ggml_archive_ext ".zip")
    else()
        message(FATAL_ERROR
            "Unsupported prebuilt ggml package for ${CMAKE_SYSTEM_NAME}/${CMAKE_SYSTEM_PROCESSOR}. "
            "Provide ROOT_DIR explicitly or extend cmake/fetch_prebuilt_ggml.cmake.")
    endif()

    set(${out_platform} "${_ggml_platform}" PARENT_SCOPE)
    set(${out_archive_ext} "${_ggml_archive_ext}" PARENT_SCOPE)
endfunction()

function(_ggml_locate_package_root out_root_dir search_root)
    if (NOT EXISTS "${search_root}")
        set(${out_root_dir} "" PARENT_SCOPE)
        return()
    endif()

    file(GLOB_RECURSE _ggml_config_candidates
        LIST_DIRECTORIES false
        "${search_root}/ggml-config.cmake")

    set(_ggml_package_root "")

    foreach(_ggml_config IN LISTS _ggml_config_candidates)
        if (_ggml_config MATCHES [[[/\\]lib[/\\]cmake[/\\]ggml[/\\]ggml-config\.cmake$]])
            get_filename_component(_ggml_config_dir "${_ggml_config}" DIRECTORY)
            get_filename_component(_ggml_package_root "${_ggml_config_dir}/../../.." ABSOLUTE)
            break()
        endif()
    endforeach()

    set(${out_root_dir} "${_ggml_package_root}" PARENT_SCOPE)
endfunction()

function(ggml_import_prebuilt)
    set(options)
    set(one_value_args
        ROOT_DIR
        OUT_ROOT_DIR
        RELEASE_BASE_URL
        RELEASE_TAG
        VERSION
        ASSET_NAME
        DOWNLOAD_URL
        CACHE_DIR)
    cmake_parse_arguments(GGML "${options}" "${one_value_args}" "" ${ARGN})

    if (GGML_RELEASE_TAG AND GGML_VERSION)
        message(FATAL_ERROR "ggml_import_prebuilt accepts RELEASE_TAG or VERSION, but not both.")
    endif()

    if (NOT GGML_OUT_ROOT_DIR)
        set(GGML_OUT_ROOT_DIR GGML_ROOT_DIR)
    endif()

    if (GGML_ROOT_DIR)
        get_filename_component(_ggml_input_root "${GGML_ROOT_DIR}" ABSOLUTE)
        _ggml_locate_package_root(_ggml_package_root "${_ggml_input_root}")

        if (NOT _ggml_package_root)
            message(FATAL_ERROR
                "Could not locate lib/cmake/ggml/ggml-config.cmake under ROOT_DIR=${_ggml_input_root}.")
        endif()
    else()
        _ggml_prebuilt_platform(_ggml_platform _ggml_archive_ext)

        if (GGML_ASSET_NAME)
            set(_ggml_asset_name "${GGML_ASSET_NAME}")
        else()
            set(_ggml_asset_name "ggml-${_ggml_platform}${_ggml_archive_ext}")
        endif()

        if (GGML_DOWNLOAD_URL)
            set(_ggml_download_url "${GGML_DOWNLOAD_URL}")
        else()
            if (NOT GGML_RELEASE_BASE_URL)
                message(FATAL_ERROR
                    "ggml_import_prebuilt requires ROOT_DIR, DOWNLOAD_URL, or RELEASE_BASE_URL + RELEASE_TAG.")
            endif()

            if (GGML_RELEASE_TAG)
                set(_ggml_release_tag "${GGML_RELEASE_TAG}")
            elseif (GGML_VERSION)
                set(_ggml_release_tag "${GGML_VERSION}")
            else()
                message(FATAL_ERROR
                    "ggml_import_prebuilt requires RELEASE_TAG or VERSION when RELEASE_BASE_URL is used.")
            endif()

            string(REGEX REPLACE "/$" "" _ggml_release_base_url "${GGML_RELEASE_BASE_URL}")
            set(_ggml_download_url "${_ggml_release_base_url}/${_ggml_release_tag}/${_ggml_asset_name}")
        endif()

        if (GGML_CACHE_DIR)
            get_filename_component(_ggml_cache_dir "${GGML_CACHE_DIR}" ABSOLUTE)
        else()
            set(_ggml_cache_dir "${CMAKE_BINARY_DIR}/_deps/ggml-prebuilt")
        endif()

        set(_ggml_archive_dir "${_ggml_cache_dir}/archives")
        set(_ggml_extract_dir "${_ggml_cache_dir}/packages/${_ggml_asset_name}")
        set(_ggml_archive_path "${_ggml_archive_dir}/${_ggml_asset_name}")

        file(MAKE_DIRECTORY "${_ggml_archive_dir}")

        if (NOT EXISTS "${_ggml_archive_path}")
            message(STATUS "Downloading prebuilt ggml package from ${_ggml_download_url}")
            file(DOWNLOAD
                "${_ggml_download_url}"
                "${_ggml_archive_path}"
                SHOW_PROGRESS
                STATUS _ggml_download_status
                LOG _ggml_download_log
                TLS_VERIFY ON)

            list(GET _ggml_download_status 0 _ggml_download_code)
            list(GET _ggml_download_status 1 _ggml_download_message)
            if (NOT _ggml_download_code EQUAL 0)
                message(FATAL_ERROR
                    "Failed to download ${_ggml_download_url}: ${_ggml_download_message}\n${_ggml_download_log}")
            endif()
        else()
            message(STATUS "Using cached prebuilt ggml archive: ${_ggml_archive_path}")
        endif()

        _ggml_locate_package_root(_ggml_package_root "${_ggml_extract_dir}")
        if (NOT _ggml_package_root)
            file(REMOVE_RECURSE "${_ggml_extract_dir}")
            file(MAKE_DIRECTORY "${_ggml_extract_dir}")

            message(STATUS "Extracting prebuilt ggml package to ${_ggml_extract_dir}")
            file(ARCHIVE_EXTRACT
                INPUT "${_ggml_archive_path}"
                DESTINATION "${_ggml_extract_dir}")

            _ggml_locate_package_root(_ggml_package_root "${_ggml_extract_dir}")
        endif()

        if (NOT _ggml_package_root)
            message(FATAL_ERROR
                "Extracted archive ${_ggml_archive_path} does not contain lib/cmake/ggml/ggml-config.cmake.")
        endif()
    endif()

    find_package(ggml CONFIG REQUIRED
        PATHS "${_ggml_package_root}"
        NO_DEFAULT_PATH)

    set(GGML_INCLUDE_DIR "${_ggml_package_root}/include" PARENT_SCOPE)
    set(GGML_LIB_DIR "${_ggml_package_root}/lib" PARENT_SCOPE)
    set(GGML_BIN_DIR "${_ggml_package_root}/bin" PARENT_SCOPE)
    set(${GGML_OUT_ROOT_DIR} "${_ggml_package_root}" PARENT_SCOPE)
    set(GGML_PREBUILT_ROOT_DIR "${_ggml_package_root}" PARENT_SCOPE)
endfunction()

function(ggml_copy_runtime_binaries target_name)
    set(options)
    set(one_value_args ROOT_DIR)
    cmake_parse_arguments(GGML "${options}" "${one_value_args}" "" ${ARGN})

    if (NOT TARGET "${target_name}")
        message(FATAL_ERROR "ggml_copy_runtime_binaries expected an existing target, got '${target_name}'.")
    endif()

    if (NOT GGML_ROOT_DIR)
        message(FATAL_ERROR "ggml_copy_runtime_binaries requires ROOT_DIR.")
    endif()

    get_filename_component(_ggml_runtime_root "${GGML_ROOT_DIR}" ABSOLUTE)
    set(_ggml_runtime_bin_dir "${_ggml_runtime_root}/bin")

    if (NOT EXISTS "${_ggml_runtime_bin_dir}")
        message(STATUS "No ggml runtime bin directory found at ${_ggml_runtime_bin_dir}; skipping copy step.")
        return()
    endif()

    add_custom_command(TARGET "${target_name}" POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${_ggml_runtime_bin_dir}"
            "$<TARGET_FILE_DIR:${target_name}>"
        COMMENT "Copying ggml runtime binaries to build directory...")
endfunction()
