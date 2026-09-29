# Contrast check

Grey text should be easy to read in both themes: this note's date and word count, the counts in the sidebar, and the chips below.

- [ ] Pay the invoice !high due:{{date:-1d}} #work
- [ ] Water the plants !low due:{{date}}
- [ ] Book the dentist due:{{date:+1w}}
- [x] Send the slides done:{{date:-1d}}

```js
// A comment in code is readable too
const total = items.reduce((sum, item) => sum + item.price, 0);
```

::timer{duration=5m label="Tea"}
