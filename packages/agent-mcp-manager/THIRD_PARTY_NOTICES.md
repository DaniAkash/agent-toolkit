# Third-Party Notices

`agent-mcp-manager` includes data derived from the following third-party
projects.

## mcp-gateway (docker/mcp-gateway)

- Source: https://github.com/docker/mcp-gateway
- License: MIT
- Files derived from this project (located under `src/_vendor/`):
  - `catalog.ts` — the v0.1 agent catalog (per-OS config paths,
    install-check heuristics, emitter selection) is hand-derived from
    upstream `pkg/client/config.yml`. Specifically the entries for
    `claude-code`, `claude-desktop`, `cursor`, `vscode`, `gemini`,
    `codex`, and `zed`.

No source code from `mcp-gateway` is incorporated; only the catalog
shape (paths and config-file conventions). Emitter implementations are
TypeScript-native and do not depend on `yq` or any Go code.

### MIT License

```
Copyright (c) Docker, Inc.

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
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
