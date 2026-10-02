---
pr: 223
title: Smart folder editor
---
1. Click the + on the Smart folders header (or ⌘K → **New smart folder**). The editor opens in the middle of the window.
2. Under **Tags**, click **Any tag** and pick `health`. Click **+ Add a tag** and pick `journal`. A **Match all of these tags** choice appears, and the rows read "and". The preview below lists only notes with both tags, like Morning run, and leaves out Meal prep (health only).
3. Switch to **Match any of these tags**. The rows now read "or", and the count goes up to every note with either tag.
4. Under **Words**, type `run`, click **+ Add a word** and type `swim`. The rows read "and": no note has both. Switch to **Match any of these words**, and Morning run and Pool laps both match.
5. Under **Folders**, click **Any folder** and type "acme". The deep folder lists with its parents dimmed. Pick it, and it shows as `Try › Smart folder editor › Areas › Work › Clients › Acme`. **+ Add a folder** adds another, and the rows read "or".
6. Under the rows, **Query** shows the query as text, built as you changed the rows; the **?** beside it opens the Query syntax page. Change it to `q="run -swim" sort=date`: the words stay as text (rows can't say `-swim`), and the controls follow. **Share with workspace** starts unticked. Name it and Save.
7. Back in **Notes**, type a search (say "run"). A star sits beside the filters. Click it: the editor opens with the search filled in, and saving puts it under Favorites as well as Smart folders. Any smart folder's row has the same star, and so does a tag alone.
