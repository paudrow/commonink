# Overview

Your workspace at a glance. Each block below is one line of markdown (or a code block), so agents can build dashboards like this too.

## Open tasks

::tasks{label="Everywhere"}

## Recently touched

::view{limit=5 label="Latest"}

## Journal

::calendar{folder=Journal}

## How it fits together

```mermaid
flowchart LR
  You[You and your team] -->|edit| WS[(Workspace)]
  Agents[Claude, ChatGPT, Cursor] -->|MCP| WS
  WS --> Live[Live everywhere]
  WS --> Search[(Full-text search)]
```
