/*
 * VENDORED, AND REDUCED, from the Schwung host:
 *   https://github.com/charlesvestal/schwung  —  src/vendor/host/plugin_api_v1.h
 *
 * MIT License. Copyright (c) 2025-2026 Charles Vestal.
 * Full text in THIRD-PARTY-NOTICES.md at the root of this repository.
 *
 * Carried here so that tests/dsp/test_drums.c exercises the engine through
 * exactly the C ABI the Move calls, rather than through a Rust-side
 * restatement of it that could drift from the real one.
 *
 * WHAT WAS REDUCED, and why saying so matters. The upstream header is mostly
 * prose — the threading contract, the realtime rules, the history behind the
 * reserved tail — and none of it survives here. Two DECLARATIONS did not
 * either: host_api_v1_t's `reserved[8]` tail and the _Static_assert that pins
 * its offset. That is safe only because of how this copy is used: the C test
 * passes NULL for the host and never constructs the struct, and the Rust side
 * (dsp/schwung-plugin) keeps its own mirror which stops at get_beat_position
 * and never appends. A module may be older than the host; it may never be
 * newer. Read the upstream header before changing anything here — it explains
 * how a module's private copy of this struct once boot-looped a device.
 *
 * Do not edit to add fields. If the host's ABI changes, replace this file
 * wholesale from upstream and re-reduce it.
 */
#ifndef MOVE_PLUGIN_API_V1_H
#define MOVE_PLUGIN_API_V1_H

#include <stdint.h>

#define MOVE_PLUGIN_API_VERSION 1
#define MOVE_PLUGIN_API_VERSION_2 2
#define MOVE_SAMPLE_RATE 44100
#define MOVE_FRAMES_PER_BLOCK 128
#define MOVE_AUDIO_OUT_OFFSET 256
#define MOVE_AUDIO_IN_OFFSET (2048 + 256)
#define MOVE_AUDIO_BYTES_PER_BLOCK 512

#define MOVE_MIDI_SOURCE_INTERNAL 0
#define MOVE_MIDI_SOURCE_EXTERNAL 2
#define MOVE_MIDI_SOURCE_HOST 3
#define MOVE_MIDI_SOURCE_FX_BROADCAST 4

#define MOVE_CLOCK_STATUS_UNAVAILABLE 0
#define MOVE_CLOCK_STATUS_STOPPED 1
#define MOVE_CLOCK_STATUS_RUNNING 2

typedef int (*move_mod_emit_value_fn)(void *ctx, const char *source_id,
                                      const char *target, const char *param,
                                      float signal, float depth, float offset,
                                      int bipolar, int enabled);
typedef void (*move_mod_clear_source_fn)(void *ctx, const char *source_id);

typedef struct host_api_v1 {
    uint32_t api_version;
    int sample_rate;
    int frames_per_block;
    uint8_t *mapped_memory;
    int audio_out_offset;
    int audio_in_offset;
    void (*log)(const char *msg);
    int (*midi_send_internal)(const uint8_t *msg, int len);
    int (*midi_send_external)(const uint8_t *msg, int len);
    int (*get_clock_status)(void);
    move_mod_emit_value_fn mod_emit_value;
    move_mod_clear_source_fn mod_clear_source;
    void *mod_host_ctx;
    float (*get_bpm)(void);
    int (*midi_inject_to_move)(const uint8_t *msg, int len);
    int (*slot_recv_channel)(void *instance);
    double (*get_beat_position)(void);
} host_api_v1_t;

typedef struct plugin_api_v1 {
    uint32_t api_version;
    int (*on_load)(const char *module_dir, const char *json_defaults);
    void (*on_unload)(void);
    void (*on_midi)(const uint8_t *msg, int len, int source);
    void (*set_param)(const char *key, const char *val);
    int (*get_param)(const char *key, char *buf, int buf_len);
    int (*get_error)(char *buf, int buf_len);
    void (*render_block)(int16_t *out_interleaved_lr, int frames);
} plugin_api_v1_t;

typedef struct plugin_api_v2 {
    uint32_t api_version;
    void *(*create_instance)(const char *module_dir, const char *json_defaults);
    void (*destroy_instance)(void *instance);
    void (*on_midi)(void *instance, const uint8_t *msg, int len, int source);
    void (*set_param)(void *instance, const char *key, const char *val);
    int (*get_param)(void *instance, const char *key, char *buf, int buf_len);
    int (*get_error)(void *instance, char *buf, int buf_len);
    void (*render_block)(void *instance, int16_t *out_interleaved_lr, int frames);
} plugin_api_v2_t;

typedef plugin_api_v1_t *(*move_plugin_init_v1_fn)(const host_api_v1_t *host);
typedef plugin_api_v2_t *(*move_plugin_init_v2_fn)(const host_api_v1_t *host);

#define MOVE_PLUGIN_INIT_SYMBOL "move_plugin_init_v1"
#define MOVE_PLUGIN_INIT_V2_SYMBOL "move_plugin_init_v2"

#endif
