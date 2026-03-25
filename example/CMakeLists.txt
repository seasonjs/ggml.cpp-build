cmake_minimum_required(VERSION 3.21)
project("example" LANGUAGES C CXX)


set(VENDOR_GGML_DIR "${CMAKE_CURRENT_SOURCE_DIR}/vendor/ggml")

# Use the exported ggml package so transitive dependencies such as
# ggml-base.lib are linked automatically.
find_package(ggml CONFIG REQUIRED
    PATHS "${VENDOR_GGML_DIR}/lib/cmake/ggml"
    NO_DEFAULT_PATH
)

add_executable(main_app main.cpp)

target_include_directories(main_app PRIVATE "${GGML_INCLUDE_DIR}")
target_link_libraries(main_app PRIVATE ggml::ggml)

add_custom_command(TARGET main_app POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${VENDOR_GGML_DIR}/bin"
        "$<TARGET_FILE_DIR:main_app>"
    COMMENT "Copying ggml runtime binaries to build directory..."
)
