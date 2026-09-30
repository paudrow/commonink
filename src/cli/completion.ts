// Shell completion scripts, made from the command table: commands, their sub-commands and their
// flags. Arguments that aren't flags complete as file names (what `upload` needs).
import { COMMANDS } from "../core/commands/index.ts";
import { cliArgs, flagOf, GLOBAL_FLAGS, topWords } from "./argv.ts";
import { OWN_COMMANDS } from "./help.ts";

const flagsOf = (cli: string) => {
  const c = COMMANDS.find((x) => x.cli === cli);
  const own = c ? cliArgs(c).flatMap(([name, a]) => [...(a.pos === undefined ? [flagOf(name, a)] : []), ...Object.keys(a.presets ?? {})]) : [];
  return [...new Set([...own, ...Object.keys(GLOBAL_FLAGS)])].map((f) => `--${f}`);
};
const groups = () => {
  const subs = new Map<string, string[]>();
  for (const c of COMMANDS) {
    const [first, second] = c.cli.split(" ");
    if (second) subs.set(first, [...(subs.get(first) ?? []), second]);
  }
  return subs;
};
const tops = () => [...new Set([...topWords(), ...OWN_COMMANDS.map((o) => o.usage.split(" ")[0])])].sort();

function bash(): string {
  const subs = groups();
  const arms = COMMANDS.map((c) => `    "${c.cli}") flags="${flagsOf(c.cli).join(" ")}" ;;`);
  const subArms = [...subs].map(([g, s]) => `    ${g}) subs="${s.join(" ")}" ;;`);
  return `# commonink completion for bash (and zsh, through bashcompinit). Add to your shell's startup file:
#   source <(commonink completion bash)
_commonink() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" w1="\${COMP_WORDS[1]}" w2="\${COMP_WORDS[2]}" key flags="" subs=""
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${tops().join(" ")}" -- "$cur")); return; fi
  case "$w1" in
${subArms.join("\n")}
  esac
  if [ "$COMP_CWORD" -eq 2 ] && [ -n "$subs" ] && [[ "$cur" != -* ]]; then COMPREPLY=($(compgen -W "$subs" -- "$cur")); return; fi
  key="$w1"; [[ " $subs " == *" $w2 "* ]] && key="$w1 $w2"
  case "$key" in
${arms.join("\n")}
  esac
  if [[ "$cur" == -* ]]; then COMPREPLY=($(compgen -W "$flags" -- "$cur")); else COMPREPLY=($(compgen -f -- "$cur")); fi
}
complete -o filenames -F _commonink commonink`;
}

function zsh(): string {
  return `# commonink completion for zsh. Add to ~/.zshrc:
#   source <(commonink completion zsh)
autoload -U +X bashcompinit && bashcompinit
${bash()}`;
}

function fish(): string {
  const subs = groups();
  const lines = [
    "# commonink completion for fish. Save as ~/.config/fish/completions/commonink.fish:",
    "#   commonink completion fish > ~/.config/fish/completions/commonink.fish",
    "complete -c commonink -f",
    `complete -c commonink -n __fish_use_subcommand -a "${tops().join(" ")}"`,
    ...[...subs].map(([g, s]) => `complete -c commonink -n "__fish_seen_subcommand_from ${g}; and not __fish_seen_subcommand_from ${s.join(" ")}" -a "${s.join(" ")}"`),
  ];
  for (const c of COMMANDS) {
    const [first, second] = c.cli.split(" ");
    const when = second ? `__fish_seen_subcommand_from ${first}; and __fish_seen_subcommand_from ${second}` : `__fish_seen_subcommand_from ${first}`;
    for (const f of flagsOf(c.cli)) lines.push(`complete -c commonink -n "${when}" -l ${f.slice(2)}`);
    if (c.cli === "upload") lines.push(`complete -c commonink -n "${when}" -F`);
  }
  return lines.join("\n");
}

export const SHELLS = { bash, zsh, fish } as const;
