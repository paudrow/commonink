# GitHub markdown sampler

This note renders the same in Common Ink and on GitHub :sparkles: Everything in it is GitHub-flavored markdown, so open the file on GitHub to compare.

Jump to [Alerts](#alerts), [Footnotes](#footnotes), [Emoji](#emoji), [HTML GitHub allows](#html-github-allows), or [Pictures for light and dark](#pictures-for-light-and-dark).

## Alerts

> [!NOTE]
> Useful information that people should know, even when skimming.[^alert] Footnotes, :bulb: emoji and <kbd>keys</kbd> work in an alert too.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information people need to reach their goal.

> [!WARNING]
> Urgent information that needs immediate attention to avoid problems.

> [!CAUTION]
> Advice about risks or negative outcomes of certain actions.

[^alert]: A footnote referenced from inside an alert.

## Footnotes

Common Ink keeps notes as plain files[^files], so any editor can open them. Footnotes are numbered in the order they're first referenced[^order], and each one links back to where it came from.[^files]

[^files]: Markdown files in a folder you choose, or in your workspace online.
[^order]: That's how GitHub numbers them too, whatever their labels say.

## Emoji

Shortcodes turn into emoji: :tada: :rocket: :white_check_mark: :warning: :heart: :+1:

Times like 10:30 and URLs like https://example.com/:tada:/party stay as written, and so does `:tada:` in code.

## HTML GitHub allows

Press <kbd>⌘</kbd> <kbd>K</kbd> to search. Water is H<sub>2</sub>O and E = mc<sup>2</sup>.<br>This sentence starts on a line of its own.

<img src="gfm-sampler-badge.svg" width="200" height="40" alt="A badge that says markdown: GitHub-flavored">

<details>
<summary>A collapsible section</summary>

It folds here and on GitHub.

</details>

## Pictures for light and dark

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="gfm-sampler-night.svg">
  <img src="gfm-sampler-day.svg" width="360" alt="A skyline: the sun in light mode, the moon in dark mode">
</picture>

The picture follows your system's appearance: switch it between light and dark to see the other one.
