# Outside-in agents

The notes app never embeds a model. Instead it makes itself **easy for any agent to use**:

1. **Files first.** Plain markdown on disk means every agent with a filesystem already works.
2. **A CLI + skill** for shell agents like Claude Code and Codex. Cheap on context.
3. **An MCP server** for everything else. Same core, same tools.

The hard part isn't the protocol. It's *sharing a document* with a collaborator who types at 1,000 words a minute:

- Edits are **exact-string replacements** with an optional `base_version`, never blind rewrites.
- When a file changes under the editor, Quire applies it as a diff, so your cursor, undo history and vim mode survive. If you had unsaved typing, it does a three-way merge.
- Every write is **attributed**: MCP writes carry the client's name, and anything else shows up as `external`.

See the plan in [[Quire roadmap]].
