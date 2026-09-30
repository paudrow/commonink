# Code sampler

Code blocks in many languages, drawn the same here, in [[Code in an embed]] and on this note's card in Notes.

```ts title="server.ts"
import { serve } from "./http.ts";

export async function start(port = 8080): Promise<void> {
  const server = await serve({ port, handler: (req) => new Response(`Hello, ${req.url}`) });
  console.log("listening on", server.addr); // a comment
}
```

```py
def fib(n: int) -> int:
    """The nth Fibonacci number."""
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(10)])
```

```sh
# Install, then run the tests
npm ci && npm test -- --watch
echo "done: $?"
```

```sql
SELECT name, count(*) AS notes
FROM tags JOIN notes ON notes.path = tags.path
WHERE tag LIKE 'work/%'
GROUP BY name ORDER BY notes DESC LIMIT 10;
```

```yml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
```

```jsonc
{
  // Comments are fine in JSONC
  "compilerOptions": { "strict": true, "target": "ES2023" }
}
```

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci
CMD ["npm", "start"]
```

A long line that wraps (the default):

```js
const message = "This line is long enough that it keeps going past the edge of the note, so it wraps onto the next line instead of scrolling sideways.";
```

The same line with `nowrap`, so it scrolls sideways and the note around it still wraps:

```js nowrap
const message = "This line is long enough that it keeps going past the edge of the note, so it scrolls sideways inside its block.";
```

A diff, with added and removed lines in green and red:

```diff
--- a/greeting.ts
+++ b/greeting.ts
@@ -1,3 +1,3 @@
 export function greet(name: string) {
-  return "Hello " + name;
+  return `Hello, ${name}!`;
 }
```

Line numbers and highlighted lines (`showLineNumbers {2-3}`):

```rust showLineNumbers {2-3}
fn main() {
    let words = vec!["code", "blocks", "everywhere"];
    println!("{}", words.join(" "));
}
```

No language:

```
Plain text stays plain.
```
