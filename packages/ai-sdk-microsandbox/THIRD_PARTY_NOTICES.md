# Third-Party Notices

`ai-sdk-microsandbox` is a sandbox provider for the Vercel AI SDK v7 harness ecosystem. It bridges two upstream projects whose attribution is recorded below.

## @ai-sdk/sandbox-vercel (vercel/ai)

- Source: https://github.com/vercel/ai
- License: Apache-2.0

`@ai-sdk/sandbox-vercel` is the reference `HarnessV1SandboxProvider` implementation. This package mirrors its interface shape and method semantics so consumers can swap providers without code changes. No source code is copied from upstream; the API contract is reproduced from the published `@ai-sdk/harness` type definitions.

### Apache License 2.0

```
Copyright (c) Vercel, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## microsandbox (superradcompany/microsandbox)

- Source: https://github.com/superradcompany/microsandbox
- License: Apache-2.0

`microsandbox` provides the underlying microVM runtime that this provider wraps. It is consumed as a peer dependency at runtime; no source code is incorporated.

### Apache License 2.0

```
Copyright (c) Superrad Company

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
