# Common Ink roadmap

Local first, then hosted. The vault on disk stays the source of truth either way.

## Now

- [x] Core: vault, SQLite FTS5 index, change log with attribution
- [x] Surfaces: web editor, stdio MCP server, `quire` CLI
- [x] Live preview, embeds, HTML notes in a sandbox

## Next

- [ ] Accept / reject agent edits as suggestions instead of applying them directly
- [ ] Git auto-commit per change, authored by the agent that made it
- [ ] Semantic search with `sqlite-vec` next to FTS5
- [ ] Remote MCP (Streamable HTTP + OAuth) so claude.ai and phones can reach the vault

> claude-code, 11:26: sketched the embedding index; see [[Outside-in agents]] for the constraints.

> claude-code, 11:36: sketched the embedding index; see [[Outside-in agents]] for the constraints.

## Later

- [ ] Multiplayer with Yjs
- [ ] Publish the editor as an MCP App so notes open inside chats

Related: [[Outside-in agents]]
