# Third-party notices

Drums Practice is MIT licensed, Copyright (c) 2026 Torben Gräber. Everything it
ships or links against is MIT or MIT-compatible; there is no GPL, LGPL or
source-available component anywhere in the tree, and nothing that would place a
condition on redistributing the built module.

Audited for release 0.1.0. Re-run the audit whenever a dependency is added:

```sh
cd dsp && cargo tree            # the whole Rust tree; there is nothing else
cat package.json                # the JavaScript side has no dependencies at all
```

## Shipped in the module tarball

### libm — MIT

<https://github.com/rust-lang/libm>. Linked into `dsp.so`. Used for `sinf` and
`expf`: the module is `no_std`, so it cannot reach the platform's maths library.
Contributors dual-license their work MIT / Apache-2.0; the crate as a whole is
available under MIT, which is the licence taken here.

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## In the repository, not shipped

### Schwung host plugin API header — MIT, Copyright (c) 2025-2026 Charles Vestal

<https://github.com/charlesvestal/schwung>. `src/vendor/host/plugin_api_v1.h`
is vendored **unmodified** (apart from a provenance banner) so that
`tests/dsp/test_drums.c` exercises the engine through exactly the C ABI the
Move calls. It is a build-time artefact of the test suite and is not in the
module tarball.

The same MIT text as above applies, under Charles Vestal's copyright.

Drums Practice is an independent module for Schwung. It is not made, endorsed
or supported by the Schwung project, nor by Ableton.

### Derived from Piano Practice — MIT, Copyright (c) 2026 Torben Gräber

<https://github.com/graebe/schwung-piano-practice>. Same author, same licence.
The `dsp/schwung-plugin` crate is carried over verbatim; the build, packaging
and install scripts, the Dockerfile, the CI workflow and
`tools/screen_buffer.mjs` are adapted from it. Noted for provenance rather than
for licence: no third party's permission is involved.

## Not used, and deliberately so

**nih-plug.** The obvious Rust plugin framework, and the one an earlier draft of
this project's conventions named. It is avoided because exporting VST3 from it
requires Steinberg's VST3 SDK, which is GPLv3-or-commercial — a plugin built
that way cannot be distributed under MIT. The Ableton Live build of this kit is
planned on **iPlug2** (MIT) for that reason. See "Ableton Live" in the README.

Nothing in the current tree depends on either; the Schwung module reaches the
host through a plain C ABI it declares itself.
