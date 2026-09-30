import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";

/**
 * The note's syntax tree, parsed to its end when that takes under 50 ms. The state's own tree holds
 * only what the parser read in its first time slice, which in a long note, or on a busy machine,
 * can stop short of the line being asked about: a line in a code block would then read as prose.
 */
export const noteTree = (state: EditorState): Tree => ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
