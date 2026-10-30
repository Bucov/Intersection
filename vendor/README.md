# Verified adapter artifact

`mozaik-jev-adapter-0.1.0-3f4cf7b.tgz` is the unmodified npm package built from
[Bucov/mozaik-Jev-adapter](https://github.com/Bucov/mozaik-Jev-adapter/tree/3f4cf7bb4b36768206832d9b500d3630c43dbfbf/adapters/jev),
commit **3f4cf7bb4b36768206832d9b500d3630c43dbfbf**, `adapters/jev`.

SHA-256: `b00561e8c3c9f48a96529b6ba15d99233aec3d94576a89150ab9104f68b848ea`.
MIT license and attribution are inside the archive. No fork changes or publication.

Verified with Node 22.23.4 / npm 10.9.9 (also 45 adapter tests passed on Node 26):

```fish
git clone --branch feature/jev-adapter https://github.com/Bucov/mozaik-Jev-adapter.git
cd mozaik-Jev-adapter
git checkout --detach 3f4cf7bb4b36768206832d9b500d3630c43dbfbf
cd adapters/jev
npm ci --workspaces=false
npm run check
npm run verify:package
npm pack --workspaces=false
```

Use the same npm cache for ci and verify:package: its temporary consumer installation
is deliberately offline. npm 12 changed `npm pack --json` from an array to an object;
the upstream verifier expects npm 10's array. Use npm 10 for rebuilding, not a patched
adapter script. Consumers only need `npm ci` at Intersection's root. The root lockfile
and server's relative `file:../../vendor/...tgz` reference make clean clones independent
of any teammate's absolute filesystem path or registry publication. Exact runtime peer
is `@mozaik-ai/core@4.1.0`; verify with `npm ls @mozaik-ai/core`.
