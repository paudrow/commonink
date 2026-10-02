---
pr: 281
title: One word per idea
---
The app now uses one word for each idea: named versions are "versions", the star fills "Starred", and agents are "agents".

1. Look at the sidebar. The section under History is now called **Starred**, like the star button that fills it. Star a note from its top bar: the button's hover text just says "Star".
2. Hover a tag under Tags and hover its star. It says "Star tag" (it used to say "Add to Favorites").
3. Open any note. Press ⌘K and type `>label`. You see **Name this version…** and **Versions of this note**. Before, it said "Label this version…" and "Labels of this note". With no note open, `>label` no longer offers "New tag".
4. Pick **Name this version…**, type `v1` and press Enter. The toast says "Named this version “v1”". The pin in History says "Named just now by You" and has a bookmark icon, not a tag.
5. Pick the pin. The trash button now says "Remove this name", and asks "Remove the name “v1”?". The note and its history stay as they are.
6. In History, the filter chips are Everyone, People and **Agents** (it used to say "AI").
7. With Vim on, `:version v2` names the version, and `:label v2` still works.
8. Add a widget (type `/` and pick Timer or Tasks) and open its settings. Its heading field is called **Title** now, not "Label".
