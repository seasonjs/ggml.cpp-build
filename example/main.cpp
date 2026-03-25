#include <stdio.h>
#include <ggml.h>
#include "ggml-backend.h"
#include "ggml-alloc.h"
#include "ggml-opt.h"

#include <cmath>
#include <cinttypes>
#include <cstring>
#include <random>
#include <string>
#include <thread>
#include <vector>
int main(void)
{
    ggml_backend_load_all();
    const size_t dev_count = ggml_backend_dev_count();
    printf("Testing %zu devices\n\n", dev_count);
    ggml_backend_t backend = ggml_backend_init_best();
    printf("Best backend: %s\n", ggml_backend_name(backend));
    std::vector<ggml_backend_dev_t> devs;
    std::vector<ggml_backend_t>     backends;

    for (size_t i = 0; i < dev_count; ++i) {
        devs.push_back(ggml_backend_dev_get(i));

        ggml_backend_t backend = ggml_backend_dev_init(devs[i], NULL);
        GGML_ASSERT(backend != NULL);

        auto * reg = ggml_backend_dev_backend_reg(devs[i]);
        auto ggml_backend_set_n_threads_fn = (ggml_backend_set_n_threads_t) ggml_backend_reg_get_proc_address(reg, "ggml_backend_set_n_threads");
        if (ggml_backend_set_n_threads_fn) {
            ggml_backend_set_n_threads_fn(backend, std::thread::hardware_concurrency() / 2);
        }
        backends.push_back(backend);
    }
}