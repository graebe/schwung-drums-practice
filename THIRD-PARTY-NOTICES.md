# Third-party notices

Drums Practice is MIT licensed (see `LICENSE`). It carries very little that is
not its own, and everything it does carry is MIT.

This file exists because `src/vendor/host/plugin_api_v1.h` points at it.

## Schwung — the host ABI header

`src/vendor/host/plugin_api_v1.h` is a reduced copy of `src/host/plugin_api_v1.h`
from the Schwung host.

- Upstream: https://github.com/charlesvestal/schwung
- MIT License. Copyright (c) 2025-2026 Charles Vestal.

It is carried so that `tests/dsp/test_drums.c` exercises the engine through
exactly the C ABI the Move calls, rather than through a Rust-side restatement
of it that could drift from the real one.

```
MIT License

Copyright (c) 2025-2026 Charles Vestal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## libm

The only external crate the DSP depends on. `dsp/drums` is `no_std`, so its
`sinf`, `expf` and `powf` come from here rather than from the Rust standard
library.

- https://github.com/rust-lang/libm — MIT.

## Everything else

- `dsp/schwung-plugin` — this repository's own crate, MIT, Copyright (c) 2026
  Torben Gräber. It is shared verbatim with `schwung-piano-practice`.
- The JavaScript has **no dependencies at all**, runtime or development. The
  test suite is `node --test` from the standard library, and the module ships
  as ES modules the host's QuickJS loads directly. There is nothing here to
  attribute and nothing to keep up to date.
