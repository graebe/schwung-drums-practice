// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The engine, through the C ABI the Move actually calls.
 *
 * Kept in C deliberately. The Rust unit tests exercise the engine from
 * inside; this is the only caller that crosses the same `extern "C"`
 * boundary, with the same vtable and the same NUL-terminated strings, that
 * the host does. Every FFI mistake this could catch is invisible from Rust.
 */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>

#include "../../src/vendor/host/plugin_api_v1.h"

/*
 * The vtable comes from the VENDORED HEADER, never from a copy written here.
 * The copy this replaced omitted get_error, which sits between get_param and
 * render_block — every pointer after it was off by one, and the first call
 * through it would have jumped into the wrong function. That is the whole
 * reason the header is vendored rather than restated.
 */
extern const plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host);

static int checks = 0;
#define CHECK(cond, msg) do { \
    checks++; \
    if (!(cond)) { fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); exit(1); } \
} while (0)

static const plugin_api_v2_t *api;
static void *inst;

static long peak(int16_t *buf, int n) {
    long p = 0;
    for (int i = 0; i < n; i++) {
        long v = buf[i] < 0 ? -(long)buf[i] : buf[i];
        if (v > p) p = v;
    }
    return p;
}

static long render_peak(int frames) {
    int n = frames * 2;
    int16_t *buf = calloc((size_t)n, sizeof(int16_t));
    api->render_block(inst, buf, frames);
    long p = peak(buf, n);
    free(buf);
    return p;
}

int main(void) {
    api = move_plugin_init_v2(NULL);
    CHECK(api != NULL, "init returned NULL");
    CHECK(api->api_version == 2, "wrong api_version");
    CHECK(api->create_instance && api->destroy_instance && api->render_block, "vtable has holes");
    CHECK(api->set_param && api->get_param && api->on_midi, "vtable has holes");

    inst = api->create_instance(NULL, NULL);
    CHECK(inst != NULL, "create_instance returned NULL");

    /* ---- get_param ---- */
    char out[32];
    memset(out, 0, sizeof out);
    int n = api->get_param(inst, "ping", out, (int)sizeof out);
    CHECK(n > 0 && strcmp(out, "1") == 0, "ping did not answer 1");

    memset(out, 0, sizeof out);
    api->get_param(inst, "drums", out, (int)sizeof out);
    CHECK(strcmp(out, "9") == 0, "the kit is not nine voices");

    memset(out, 0, sizeof out);
    n = api->get_param(inst, "nonsense", out, (int)sizeof out);
    CHECK(n == 0, "an unknown key must write nothing");

    /* A one-byte buffer must not be overrun. */
    char tiny[2] = { 'x', 'x' };
    n = api->get_param(inst, "ping", tiny, 1);
    CHECK(n <= 1, "get_param wrote past the buffer it was given");

    /* ---- silence ---- */
    CHECK(render_peak(128) == 0, "the engine made noise before being asked");

    /* ---- render ADDS, never assigns ---- */
    int16_t keep[256];
    for (int i = 0; i < 256; i++) keep[i] = 1234;
    api->render_block(inst, keep, 128);
    CHECK(keep[0] == 1234 && keep[255] == 1234, "silence overwrote the host's buffer");

    /* ---- one write carries a whole stack ---- */
    api->set_param(inst, "n", "7:110,5:100,1:80");
    memset(out, 0, sizeof out);
    render_peak(128);
    api->get_param(inst, "voices", out, (int)sizeof out);
    CHECK(strcmp(out, "3") == 0, "three drums in one write did not all start");
    CHECK(render_peak(512) > 0, "the kit made no sound");

    /* ---- panic ---- */
    api->set_param(inst, "panic", NULL);
    render_peak(128);
    memset(out, 0, sizeof out);
    api->get_param(inst, "voices", out, (int)sizeof out);
    CHECK(strcmp(out, "0") == 0, "panic left a voice running");
    CHECK(render_peak(256) == 0, "panic left sound behind");

    /* ---- malformed input loses only itself ---- */
    api->set_param(inst, "n", "5:100,rubbish,,7:90,99:100,:5,3:");
    render_peak(128);
    memset(out, 0, sizeof out);
    api->get_param(inst, "voices", out, (int)sizeof out);
    CHECK(strcmp(out, "2") == 0, "a malformed entry took its neighbours with it");
    api->set_param(inst, "panic", NULL);
    render_peak(128);

    /* NULL values must not be dereferenced. */
    api->set_param(inst, "n", NULL);
    api->set_param(inst, "gain", NULL);
    api->set_param(inst, "c", NULL);
    render_peak(128);

    /* ---- the click is never starved by the kit ---- */
    api->set_param(inst, "panic", NULL);
    render_peak(128);
    for (int i = 0; i < 24; i++) {
        api->set_param(inst, "n", "0:120");
        render_peak(64);
    }
    memset(out, 0, sizeof out);
    api->get_param(inst, "voices", out, (int)sizeof out);
    CHECK(strcmp(out, "16") == 0, "the voice pool is not full");
    api->set_param(inst, "panic", NULL);
    render_peak(64);
    api->set_param(inst, "c", "1");
    CHECK(render_peak(256) > 0, "the click was starved by a busy bar");

    /* ---- MIDI is panic-only, on every channel ---- */
    for (int ch = 0; ch < 16; ch++) {
        api->set_param(inst, "n", "0:120");
        render_peak(64);
        uint8_t cc120[3] = { (uint8_t)(0xB0 | ch), 120, 0 };
        api->on_midi(inst, cc120, 3, 0);
        render_peak(64);
        memset(out, 0, sizeof out);
        api->get_param(inst, "voices", out, (int)sizeof out);
        CHECK(strcmp(out, "0") == 0, "CC120 was ignored on some channel");
    }
    uint8_t reset[1] = { 0xFF };
    api->set_param(inst, "n", "0:120");
    render_peak(64);
    api->on_midi(inst, reset, 1, 0);
    render_peak(64);
    memset(out, 0, sizeof out);
    api->get_param(inst, "voices", out, (int)sizeof out);
    CHECK(strcmp(out, "0") == 0, "System Reset was ignored");

    /* A note-on must start nothing: hits arrive by parameter, and doing both
     * would sound every stroke twice. */
    uint8_t noteon[3] = { 0x90, 60, 100 };
    api->on_midi(inst, noteon, 3, 0);
    render_peak(64);
    memset(out, 0, sizeof out);
    api->get_param(inst, "voices", out, (int)sizeof out);
    CHECK(strcmp(out, "0") == 0, "a MIDI note-on started a voice");

    /* ---- gain refuses nonsense rather than muting ---- */
    api->set_param(inst, "gain", "nonsense");
    api->set_param(inst, "gain", "5");
    api->set_param(inst, "n", "7:120");
    CHECK(render_peak(1024) > 0, "an out-of-range gain silenced the kit");

    /* ---- odd frame counts, and zero ---- */
    int16_t small[2] = { 0, 0 };
    api->render_block(inst, small, 1);
    api->render_block(inst, small, 0);

    api->destroy_instance(inst);
    printf("ok: %d checks\n", checks);
    return 0;
}
